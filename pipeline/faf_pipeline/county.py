"""Experimental county-level estimates (BTS, FAF5.6.1-based, 2022, tons only).

Each state zip holds four tables: county-to-county flows for the state and every adjacent state, county-to-FAF-zone flows from that
multistate area to all other zones, FAF-zone-to-county flows back, and zone-to-zone flows among the other zones. Only the first three
can touch the state; the fourth is skipped. We keep the rows that touch the state, so nothing is counted twice.
"""

from __future__ import annotations

import json
from typing import Any

from faf_pipeline.config import ConfigError, Context
from faf_pipeline.duck import connect, sql_literal, write_json, write_parquet
from faf_pipeline.fetch import extract_member, local_path
from faf_pipeline.flows import _read_header, _typed
from faf_pipeline.schema import check_header, load_schema
from faf_pipeline.zones import _round_coords

MODE_GROUPS = ("truck", "rail", "water", "pipeline")
KEY_COLS = ["table_kind", "trade_type", "fr_orig", "fr_inmode", "fr_dest", "fr_outmode", "orig", "dest", "sctg_group", "dms_mode"]


def _stage(ctx: Context, con, kind: str, spec: dict[str, Any], year: int, zip_path, log) -> None:
    schema = load_schema(ctx, spec["schema"])
    csv = extract_member(zip_path, spec["member"], ctx.paths.extract / "county")
    header = _read_header(con, csv)
    years = check_header(schema, header).years
    if sorted(years) != [year]:
        raise ConfigError(f"county {kind}: expected only tons_{year}, found years {sorted(years)}")
    sel = [f"  {_typed(src, c['type'])} AS {c['canonical']}" for src, c in schema.columns.items()]
    sel.append(f"  TRY_CAST(\"{years[year]['tons']}\" AS DOUBLE) AS tons_kt")
    con.execute(f"CREATE OR REPLACE TABLE stg_{kind} AS SELECT\n{', '.join(sel)}\nFROM read_csv({sql_literal(csv.as_posix())}, all_varchar = true, header = true)")
    n = con.execute(f"SELECT count(*) FROM stg_{kind}").fetchone()[0]
    log(f"    {kind}: {n} rows read")


def build(ctx: Context, log=print) -> dict[str, Any]:
    spec = ctx.sources["products"]["county"]
    year = int(spec["year"])
    fips = ctx.state.fips
    out = ctx.paths.out
    con = connect(spatial=True)
    zip_path = local_path(ctx, "county", "tables")
    for kind, tspec in spec["tables"].items():
        _stage(ctx, con, kind, tspec, year, zip_path, log)

    # state-touching rows only, one unified table. orig/dest are county FIPS (5) where the table is county-level there, else a FAF zone id (3).
    f = sql_literal(fips)
    # explicit per-table selects (the tables name their columns differently)
    sql = f"""
    SELECT 'c2c' AS table_kind, trade_type, fr_orig, fr_inmode, fr_dest, fr_outmode, orig_county AS orig, dest_county AS dest,
           orig_zone, dest_zone, sctg_group, dms_mode, tons_kt FROM stg_c2c
      WHERE (left(orig_county, 2) = {f} OR left(dest_county, 2) = {f}) AND tons_kt > 0
    UNION ALL
    SELECT 'c2f', trade_type, fr_orig, fr_inmode, fr_dest, fr_outmode, orig_county, dest_zone, orig_zone, dest_zone, sctg_group, dms_mode, tons_kt FROM stg_c2f
      WHERE left(orig_county, 2) = {f} AND tons_kt > 0
    UNION ALL
    SELECT 'f2c', trade_type, fr_orig, fr_inmode, fr_dest, fr_outmode, orig_zone, dest_county, orig_zone, dest_zone, sctg_group, dms_mode, tons_kt FROM stg_f2c
      WHERE left(dest_county, 2) = {f} AND tons_kt > 0
    """
    con.execute(f"CREATE OR REPLACE TABLE county_touching AS {sql}")
    # empty strings from the CSV become NULL through _typed(); foreign fields stay NULL for domestic rows
    n = con.execute("SELECT count(*) FROM county_touching").fetchone()[0]
    by_kind = dict(con.execute("SELECT table_kind, count(*) FROM county_touching GROUP BY 1 ORDER BY 1").fetchall())
    if n == 0 or set(by_kind) != {"c2c", "c2f", "f2c"}:
        raise ConfigError(f"county product: state filter kept {n} rows by table {by_kind}; expected rows from all three tables")
    dup = con.execute(f"SELECT count(*) FROM (SELECT 1 FROM county_touching GROUP BY {', '.join(KEY_COLS)} HAVING count(*) > 1)").fetchone()[0]
    if dup:
        raise ConfigError(f"county product: {dup} duplicate keys")

    # adjacent states are whatever other states' counties appear in the county-to-county table (not typed anywhere)
    states = [r[0] for r in con.execute(
        "SELECT DISTINCT s FROM (SELECT left(orig_county, 2) AS s FROM stg_c2c UNION SELECT left(dest_county, 2) FROM stg_c2c) ORDER BY 1").fetchall()]
    adjacent = [s for s in states if s != fips]
    if fips not in states or not adjacent:
        raise ConfigError(f"county product: could not derive adjacent states from the county-to-county table ({states})")

    dest = out / "county" / "flows" / "mid" / f"{year}.parquet"
    q = f"""SELECT {sql_literal(spec['faf_version'])} AS faf_version, CAST(NULL AS SMALLINT) AS benchmark_year, 'experimental' AS data_version, 'mid' AS scenario,
        CAST({year} AS SMALLINT) AS year, fr_orig, orig AS dms_orig, dest AS dms_dest, fr_dest, fr_inmode, dms_mode, fr_outmode,
        sctg_group AS sctg2, trade_type, CAST(NULL AS SMALLINT) AS dist_band, tons_kt,
        CAST(NULL AS DOUBLE) AS value_const_musd, CAST(NULL AS DOUBLE) AS value_current_musd, CAST(NULL AS DOUBLE) AS tmiles_m,
        {sql_literal(spec['tables']['c2c']['member'].split('.')[0] + ' / ' + spec['tables']['c2f']['member'].split('.')[0] + ' / ' + spec['tables']['f2c']['member'].split('.')[0])} AS source_file,
        orig_zone, dest_zone, table_kind
        FROM county_touching ORDER BY {', '.join(f'{c} NULLS FIRST' for c in KEY_COLS)}"""
    rows = write_parquet(con, q, dest)
    totals = dict(con.execute("SELECT table_kind, round(sum(tons_kt), 3) FROM county_touching GROUP BY 1 ORDER BY 1").fetchall())
    log(f"  county flows: {rows} rows ({by_kind}), adjacent states {adjacent}")

    # ---- disaggregation factors for the state's zones and the adjacent states' zones
    fz = ctx.paths.extract / "county" / "factors"
    fzip = local_path(ctx, "county", "factors")
    keep_states = [fips, *adjacent]
    frames = []
    for stem, group in spec["factor_files"].items():
        for direction, col in (("origin", "orig"), ("destination", "dest")):
            member = f"{stem}_{direction}_factors.csv"
            csv = extract_member(fzip, member, fz)
            hdr = _read_header(con, csv)
            want = [f"dms_{col}", f"dms_{col}_cnty", "sctgG5", f"f_{col}"]
            if [h.strip('"') for h in hdr] != want:
                raise ConfigError(f"factor file {member}: expected columns {want}, found {hdr}")
            frames.append(
                f"SELECT {sql_literal(group)} AS mode_group, {sql_literal(direction)} AS direction, lpad(dms_{col}, 3, '0') AS faf_zone, "
                f"lpad(dms_{col}_cnty, 5, '0') AS county_fips, sctgG5 AS commodity_group, CAST(f_{col} AS DOUBLE) AS factor "
                f"FROM read_csv({sql_literal(csv.as_posix())}, all_varchar = true, header = true) "
                f"WHERE left(lpad(dms_{col}, 3, '0'), 2) IN ({', '.join(sql_literal(s) for s in keep_states)})")
    con.execute("CREATE OR REPLACE TABLE fac AS " + " UNION ALL ".join(frames))
    fac_rows = write_parquet(con, "SELECT * FROM fac ORDER BY mode_group, direction, faf_zone, county_fips, commodity_group", out / "county" / "factors.parquet")
    bad = con.execute("SELECT count(*) FROM (SELECT 1 FROM fac GROUP BY mode_group, direction, faf_zone, commodity_group HAVING abs(sum(factor) - 1) > 1e-5)").fetchone()[0]
    if bad:
        raise ConfigError(f"county factors: {bad} (mode, direction, zone, commodity group) sets do not sum to 1")
    log(f"  county factors: {fac_rows} rows for zones in states {keep_states}")

    geo = _geography(ctx, con, keep_states, fips, log)
    return {"rows": rows, "rows_by_table": by_kind, "tons_by_table": totals, "adjacent_states": adjacent, "factors_rows": fac_rows,
            "county_features": geo["features"], "state_counties": geo["state_counties"], "years": {year: {"rows": rows, "data_version": "experimental"}}}


def _geography(ctx: Context, con, states: list[str], fips: str, log) -> dict[str, Any]:
    """County polygons (state + adjacent), anchors for every county and outside FAF zone used by the flows."""
    from faf_pipeline.fetch import extracted
    geo = ctx.sources["geo"]
    shp = extracted(ctx, "census_county_boundaries", "counties")
    inl = ", ".join(sql_literal(s) for s in states)
    con.execute(f"CREATE OR REPLACE TABLE cshape AS SELECT GEOID AS zone_id, NAMELSAD || ', ' || STUSPS AS cname, STATEFP AS state_fips, geom "
                f"FROM ST_Read({sql_literal(shp.as_posix())}) WHERE STATEFP IN ({inl})")
    have = {r[0] for r in con.execute("SELECT zone_id FROM cshape").fetchall()}
    used = {r[0] for r in con.execute("SELECT DISTINCT c FROM (SELECT dms_orig AS c FROM read_parquet(" + sql_literal((ctx.paths.out / 'county' / 'flows' / 'mid').as_posix() + '/*.parquet') + ") "
                                     "UNION SELECT dms_dest FROM read_parquet(" + sql_literal((ctx.paths.out / 'county' / 'flows' / 'mid').as_posix() + '/*.parquet') + ")) WHERE length(c) = 5").fetchall()}
    missing = sorted(used - have)
    if missing:
        raise ConfigError(f"county flows reference counties with no boundary in the Census file: {missing[:8]}")
    feats = []
    for zid, name, st, gj in con.execute(
            f"SELECT zone_id, cname, state_fips, ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, {geo['zone_simplify_deg']})) FROM cshape ORDER BY zone_id").fetchall():
        g = json.loads(gj)
        g["coordinates"] = _round_coords(g["coordinates"], geo["coord_decimals"])
        feats.append({"type": "Feature", "id": zid, "properties": {"zone_id": zid, "name": name, "state_fips": st, "type": "county", "is_state_zone": st == fips}, "geometry": g})
    dest = ctx.paths.out / "geo" / "county_zones.geojson"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")

    # anchors: county = Census 2020 center of population; outside FAF zones reuse the FAF5 zone anchors from dim_zone
    from faf_pipeline.zones import _load_counties
    _load_counties(ctx, con)
    centers = {r[0]: (r[1], r[2]) for r in con.execute(
        "SELECT STATEFP || COUNTYFP, CAST(LONGITUDE AS DOUBLE), CAST(LATITUDE AS DOUBLE) FROM counties").fetchall()}
    fallback = {r[0]: (r[1], r[2]) for r in con.execute("SELECT zone_id, ST_X(ST_PointOnSurface(geom)), ST_Y(ST_PointOnSurface(geom)) FROM cshape").fetchall()}
    locs = []
    for f in feats:
        p = f["properties"]
        lon, lat = centers.get(p["zone_id"], fallback[p["zone_id"]])
        locs.append({"id": p["zone_id"], "name": p["name"], "lon": round(lon, 5), "lat": round(lat, 5), "type": "county", "state_fips": p["state_fips"], "is_state_zone": p["is_state_zone"]})
    flows_glob = sql_literal((ctx.paths.out / "county" / "flows" / "mid").as_posix() + "/*.parquet")
    # outside FAF zones are the 3-character endpoints (counties are 5)
    zones_used = [r[0] for r in con.execute(
        f"SELECT DISTINCT c FROM (SELECT dms_orig AS c FROM read_parquet({flows_glob}) UNION SELECT dms_dest FROM read_parquet({flows_glob})) WHERE length(c) = 3 ORDER BY 1").fetchall()]
    dz = {r[0]: r[1:] for r in con.execute(
        "SELECT zone_id, short_name, state_fips, type, anchor_lon, anchor_lat FROM read_parquet(" + sql_literal((ctx.paths.out / 'meta' / 'dim_zone.parquet').as_posix()) + ") WHERE faf_version = '"
        + ctx.sources["products"]["faf5"]["faf_version"] + "'").fetchall()}
    county_ids = {loc["id"] for loc in locs}
    for z in zones_used:
        if z in dz and z not in county_ids:
            short, st, typ, lon, lat = dz[z]
            locs.append({"id": z, "name": short, "lon": float(lon), "lat": float(lat), "type": typ, "state_fips": st, "is_state_zone": False})
    write_json(sorted(locs, key=lambda x: (x["type"] != "county", x["id"])), ctx.paths.out / "geo" / "county_locations.json")
    n_state = sum(1 for f in feats if f["properties"]["is_state_zone"])
    log(f"  county geography: {len(feats)} counties ({n_state} in the state), {len(locs) - len(feats)} outside FAF zones, {dest.stat().st_size / 1e6:.2f} MB geojson")
    return {"features": len(feats), "state_counties": [f["properties"]["zone_id"] for f in feats if f["properties"]["is_state_zone"]]}
