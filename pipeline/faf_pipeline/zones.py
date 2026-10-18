"""Zone geography: simplified GeoJSON per FAF version, zone anchor points, foreign-region anchors, dim_zone."""

from __future__ import annotations

import json
from typing import Any

from faf_pipeline.config import ConfigError, Context
from faf_pipeline.dims import _sheet, metadata_path
from faf_pipeline.dims import zones as zone_lookup
from faf_pipeline.duck import connect, sql_literal, write_json, write_parquet
from faf_pipeline.fetch import extracted

ANCHOR_SQL = """
CREATE OR REPLACE TABLE anchor_counties AS
SELECT z.zone_id,
       c.STATEFP || c.COUNTYFP AS county_fips,
       CAST(c.POPULATION AS DOUBLE) AS pop,
       CAST(c.LONGITUDE AS DOUBLE) AS lon,
       CAST(c.LATITUDE AS DOUBLE) AS lat
FROM zshape z
JOIN counties c ON c.STATEFP = left(z.zone_id, 2)
WHERE ST_Within(ST_Point(CAST(c.LONGITUDE AS DOUBLE), CAST(c.LATITUDE AS DOUBLE)), z.geom);
"""


def _round_coords(obj: Any, nd: int) -> Any:
    if isinstance(obj, float):
        return round(obj, nd)
    if isinstance(obj, list):
        return [_round_coords(x, nd) for x in obj]
    return obj


def _load_shapes(ctx: Context, con, product: str) -> None:
    z = ctx.sources["products"][product]["zones"]
    shp = extracted(ctx, product, "zones")
    con.execute(
        f"CREATE OR REPLACE TABLE zshape AS SELECT lpad(CAST({z['id_field']} AS VARCHAR), 3, '0') AS zone_id, "
        f"CAST({z['name_field']} AS VARCHAR) AS shape_name, geom FROM ST_Read({sql_literal(shp.as_posix())})")
    got = {r[0] for r in con.execute("SELECT zone_id FROM zshape").fetchall()}
    want = {zz.zone_id for zz in zone_lookup(ctx, product)}
    if got != want:
        raise ConfigError(f"{product}: zone shapefile ids differ from metadata lookup "
                          f"(only in shapes: {sorted(got - want)}, only in lookup: {sorted(want - got)})")


def _load_counties(ctx: Context, con) -> None:
    path = extracted(ctx, "census_county_centers", "counties")
    con.execute(f"CREATE OR REPLACE TABLE counties AS SELECT * FROM read_csv({sql_literal(path.as_posix())}, "
                "all_varchar = true, header = true, encoding = 'utf-8')")
    cols = [d[0].lstrip("﻿") for d in con.execute("SELECT * FROM counties LIMIT 0").description]
    need = ["STATEFP", "COUNTYFP", "POPULATION", "LATITUDE", "LONGITUDE"]
    if [c for c in need if c not in cols]:
        raise ConfigError(f"county centers file: expected columns {need}, found {cols}")
    first = con.execute("SELECT * FROM counties LIMIT 0").description[0][0]
    if first != "STATEFP":
        con.execute(f'ALTER TABLE counties RENAME COLUMN "{first}" TO STATEFP')


def _anchors(con, product_zones) -> dict[str, dict[str, Any]]:
    """Population-weighted point of the county centers inside each zone; fall back to the most populous county center
    when the weighted point is outside the zone polygon, and to a point on the surface when no county center falls inside."""
    con.execute(ANCHOR_SQL)
    out: dict[str, dict[str, Any]] = {}
    shapes = con.execute("SELECT zone_id, geom FROM zshape ORDER BY zone_id").fetchall()
    for (zid, _geom) in shapes:
        rows = con.execute("SELECT lon, lat, pop FROM anchor_counties WHERE zone_id = ? ORDER BY county_fips", [zid]).fetchall()
        if not rows:
            lon, lat = con.execute("SELECT ST_X(p), ST_Y(p) FROM (SELECT ST_PointOnSurface(geom) p FROM zshape WHERE zone_id = ?)", [zid]).fetchone()
            out[zid] = {"lon": lon, "lat": lat, "method": "point_on_surface", "n_counties": 0}
            continue
        tot = sum(r[2] for r in rows)
        if tot <= 0:
            lon, lat = sum(r[0] for r in rows) / len(rows), sum(r[1] for r in rows) / len(rows)
        else:
            lon, lat = sum(r[0] * r[2] for r in rows) / tot, sum(r[1] * r[2] for r in rows) / tot
        inside = con.execute("SELECT ST_Within(ST_Point(?, ?), geom) FROM zshape WHERE zone_id = ?", [lon, lat, zid]).fetchone()[0]
        method = "population_weighted_county_centers"
        if not inside:
            lon, lat, _ = max(rows, key=lambda r: (r[2], -r[0], -r[1]))
            method = "most_populous_county_center"
        out[zid] = {"lon": lon, "lat": lat, "method": method, "n_counties": len(rows)}
    return out


def _geojson(con, tol: float, nd: int, meta: dict[str, Any]) -> dict[str, Any]:
    feats = []
    rows = con.execute("SELECT zone_id, ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, ?)) FROM zshape ORDER BY zone_id", [tol]).fetchall()
    for zid, gj in rows:
        g = json.loads(gj)
        g["coordinates"] = _round_coords(g["coordinates"], nd)
        m = meta[zid]
        feats.append({"type": "Feature", "id": zid,
                      "properties": {"zone_id": zid, "name": m["short_name"], "state_fips": m["state_fips"],
                                     "type": m["type"], "is_state_zone": m["is_state_zone"]},
                      "geometry": g})
    return {"type": "FeatureCollection", "features": feats}


def build(ctx: Context, products: list[str], log=print) -> dict[str, Any]:
    stats: dict[str, Any] = {}
    con = connect(spatial=True, excel=True)
    _load_counties(ctx, con)
    geo = ctx.sources["geo"]
    centroids: dict[str, Any] = {}
    all_dim: list[tuple] = []
    for product in [p for p in products if p in ("faf5", "faf6")]:
        spec = ctx.sources["products"][product]
        zl = zone_lookup(ctx, product)
        meta = {z.zone_id: {"short_name": z.short_name, "long_name": z.long_name, "state_fips": z.state_fips,
                            "type": z.type, "is_state_zone": z.is_state_zone} for z in zl}
        _load_shapes(ctx, con, product)
        anchors = _anchors(con, zl)
        gj = _geojson(con, geo["zone_simplify_deg"], geo["coord_decimals"], meta)
        dest = ctx.paths.out / "geo" / f"{product}_zones.geojson"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(gj, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        centroids[spec["faf_version"]] = {zid: [round(a["lon"], 5), round(a["lat"], 5)] for zid, a in sorted(anchors.items())}
        for z in zl:
            a = anchors[z.zone_id]
            all_dim.append((spec["faf_version"], z.zone_id, z.short_name, z.long_name, z.state_fips, z.type, z.is_state_zone,
                            round(a["lon"], 5), round(a["lat"], 5), a["method"], a["n_counties"]))
        by_method: dict[str, int] = {}
        for a in anchors.values():
            by_method[a["method"]] = by_method.get(a["method"], 0) + 1
        stats[product] = {"zones": len(zl), "geojson_bytes": dest.stat().st_size, "anchor_methods": by_method}
        log(f"  {product}: {len(zl)} zones, {dest.stat().st_size / 1e6:.2f} MB geojson, anchors {by_method}")
    con.execute("CREATE OR REPLACE TABLE dz (faf_version VARCHAR, zone_id VARCHAR, short_name VARCHAR, long_name VARCHAR, "
                "state_fips VARCHAR, type VARCHAR, is_state_zone BOOLEAN, anchor_lon DOUBLE, anchor_lat DOUBLE, "
                "anchor_method VARCHAR, anchor_n_counties INTEGER)")
    con.executemany("INSERT INTO dz VALUES (?,?,?,?,?,?,?,?,?,?,?)", all_dim)
    write_parquet(con, "SELECT * FROM dz ORDER BY faf_version, zone_id", ctx.paths.out / "meta" / "dim_zone.parquet")
    write_json(centroids, ctx.paths.out / "geo" / "zone_centroids.json")

    # Foreign regions: schematic anchors (no real geometry exists).
    labels = {r[0]: r[1] for r in _sheet(con, metadata_path(ctx, "faf6"), "foreign")}
    regions = []
    for rid, pos in sorted(ctx.app["foreign_regions"].items()):
        if str(rid) not in labels:
            raise ConfigError(f"config/app.yml foreign_regions has {rid}, not in the FAF foreign region list")
        regions.append({"region_id": str(rid), "label": labels[str(rid)], "lon": pos["lon"], "lat": pos["lat"], "schematic": True})
    missing = sorted(set(labels) - {r["region_id"] for r in regions})
    if missing:
        raise ConfigError(f"config/app.yml foreign_regions is missing anchors for {missing}")
    write_json(regions, ctx.paths.out / "geo" / "foreign_regions.json")
    return stats
