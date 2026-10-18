"""FAF5 model highway network: clip to the state, link attributes, link flows (long), PMTiles."""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any

import yaml

from faf_pipeline.config import Context, ConfigError
from faf_pipeline.dims import state_zone_ids
from faf_pipeline.duck import connect, sql_literal, write_parquet
from faf_pipeline.fetch import extract_member, extracted, plan
from faf_pipeline.schema import check_header, load_schema
from faf_pipeline.zones import _load_shapes

COL_RX = re.compile(r"^(?P<dir>AB|BA|TOT) (?:(?P<group>.+)-)?(?P<measure>Tons|Trips)_(?P<token>[0-9]+[A-Za-z]*) (?P<type>[A-Za-z]+)$")
MEASURE_COLS = ("ab_tons_k", "ba_tons_k", "tot_tons_k", "ab_trips_day", "ba_trips_day", "tot_trips_day")
LINK_TYPES = {
    "smallint": "CAST({c} AS SMALLINT)", "integer": "CAST({c} AS INTEGER)", "double": "CAST({c} AS DOUBLE)",
    "varchar": "CAST({c} AS VARCHAR)", "zone3": "lpad(CAST({c} AS VARCHAR), 3, '0')",
}


def _links_table(ctx: Context, con) -> list[str]:
    """Load the link layer into `links` with canonical column names; returns canonical attribute columns (no geometry)."""
    gdb = extracted(ctx, "network", "links")
    con.execute(f"CREATE OR REPLACE TABLE raw_links AS SELECT * FROM ST_Read({sql_literal(gdb.as_posix())})")
    header = [d[0] for d in con.execute("SELECT * FROM raw_links LIMIT 0").description]
    schema = load_schema(ctx, "network_links")
    check_header(schema, header)
    sel, attrs = [], []
    for src, spec in schema.columns.items():
        name, typ = spec["canonical"], spec["type"]
        if typ == "geometry":
            sel.append(f'"{src}" AS {name}')
        else:
            sel.append(f'{LINK_TYPES[typ].format(c=chr(34) + src + chr(34))} AS {name}')
            attrs.append(name)
    con.execute(f"CREATE OR REPLACE TABLE links AS SELECT {', '.join(sel)} FROM raw_links")
    dups = con.execute("SELECT count(*) - count(DISTINCT link_id) FROM links").fetchone()[0]
    if dups:
        raise ConfigError(f"network links: {dups} duplicate link ids")
    return attrs


def _clip(ctx: Context, con) -> dict[str, Any]:
    """Select links intersecting the state polygon buffered by network_buffer_km (buffered in a local metric projection)."""
    _load_shapes(ctx, con, "faf5")      # the network is a FAF5 product; use FAF5 zone shapes for the state polygon
    ids = state_zone_ids(ctx, "faf5")
    inlist = ", ".join(sql_literal(z) for z in ids)
    con.execute(f"CREATE OR REPLACE TABLE state_poly AS SELECT ST_Union_Agg(geom) AS g FROM zshape WHERE zone_id IN ({inlist})")
    lon, lat = con.execute("SELECT ST_X(ST_Centroid(g)), ST_Y(ST_Centroid(g)) FROM state_poly").fetchone()
    proj = f"+proj=aeqd +lat_0={lat:.4f} +lon_0={lon:.4f} +datum=NAD83 +units=m +no_defs"
    buf_m = ctx.state.network_buffer_km * 1000.0
    con.execute(
        f"CREATE OR REPLACE TABLE clip_poly AS SELECT ST_Transform(ST_Buffer(ST_Transform(g, 'EPSG:4269', {sql_literal(proj)}), {buf_m}), "
        f"{sql_literal(proj)}, 'EPSG:4269') AS g FROM state_poly")
    con.execute("CREATE OR REPLACE TABLE clip AS SELECT l.link_id FROM links l, clip_poly c WHERE ST_Intersects(l.geom, c.g)")
    n_clip = con.execute("SELECT count(*) FROM clip").fetchone()[0]
    n_state = con.execute(f"SELECT count(*) FROM links WHERE state_fips = {sql_literal(ctx.state.fips)}").fetchone()[0]
    n_state_in_clip = con.execute(
        f"SELECT count(*) FROM links l JOIN clip c USING (link_id) WHERE l.state_fips = {sql_literal(ctx.state.fips)}").fetchone()[0]
    if n_clip == 0 or n_state_in_clip != n_state:
        raise ConfigError(f"network clip kept {n_clip} links and {n_state_in_clip}/{n_state} of the state's own links; "
                          "the clip must contain every link tagged with the state FIPS")
    return {"links_in_clip": n_clip, "links_in_state": n_state, "buffer_km": ctx.state.network_buffer_km}


def _parse_table(header: list[str], table_token: str, year_token: str, groups: dict[str, dict]) -> dict[str, dict[str, str]]:
    """Map slug -> {measure column name -> source column}, enforcing the guard rules."""
    found: dict[str, dict[str, str]] = {}
    problems = []
    for col in header:
        if col == "ID":
            continue
        m = COL_RX.match(col)
        if not m:
            problems.append(f"unparseable column {col!r}")
            continue
        if m["token"] != year_token:
            problems.append(f"{col!r}: year token {m['token']!r}, expected {year_token!r}")
        if m["type"] != table_token:
            problems.append(f"{col!r}: type token {m['type']!r}, expected {table_token!r}")
        g = m["group"]
        if g is None:
            slug = "all"
        elif g in groups:
            slug = groups[g]["slug"]
        else:
            problems.append(f"{col!r}: unknown commodity group {g!r} (add it to schemas/network_groups.yml)")
            continue
        name = f"{m['dir'].lower()}_{'tons_k' if m['measure'] == 'Tons' else 'trips_day'}"
        found.setdefault(slug, {})[name] = col
    for slug, cols in found.items():
        if set(cols) != set(MEASURE_COLS):
            problems.append(f"group {slug}: columns {sorted(cols)} (expected {sorted(MEASURE_COLS)})")
    if "all" not in found:
        problems.append("no all-commodity columns")
    missing = {g["slug"] for g in groups.values()} - set(found)
    if missing:
        problems.append(f"commodity groups missing from table: {sorted(missing)}")
    if problems:
        raise ConfigError("assignment table header: " + "; ".join(problems[:6]))
    return found


def _link_flows(ctx: Context, con, log) -> dict[str, Any]:
    net = ctx.sources["products"]["network"]
    groups = yaml.safe_load((ctx.paths.schemas / "network_groups.yml").read_text(encoding="utf-8"))["groups"]
    items = {it.role: it for it in plan(ctx, ["network"])}
    stats: dict[str, Any] = {}
    for a in net["assignments"]:
        year = a["year"]
        it = items[f"assignment_{year}"]
        part_tables = []
        for i, (stem, tspec) in enumerate(net["tables"].items()):
            csv = _extract_csv(ctx, it.dest, a["member_dir"], f"{stem}{a['file_suffix']}")
            src = f"read_csv({sql_literal(csv.as_posix())}, all_varchar = true, header = true)"
            header = [d[0] for d in con.execute(f"SELECT * FROM {src} LIMIT 0").description]
            found = _parse_table(header, tspec["token"], a["token"], groups)
            con.execute(f'CREATE OR REPLACE TABLE wide AS SELECT CAST("ID" AS INTEGER) AS link_id, * EXCLUDE ("ID") FROM {src} '
                        f'WHERE CAST("ID" AS INTEGER) IN (SELECT link_id FROM clip)')
            selects = []
            for slug in sorted(found):
                cols = ", ".join(f'TRY_CAST("{found[slug][m]}" AS DOUBLE) AS {m}' for m in MEASURE_COLS)
                selects.append(f"SELECT link_id, {year} AS year, {sql_literal(tspec['truck_type'])} AS truck_type, "
                               f"{sql_literal(tspec['market'])} AS market, {sql_literal(slug)} AS commodity_group, {cols} FROM wide")
            con.execute(f"CREATE OR REPLACE TABLE part_{i} AS " + " UNION ALL ".join(selects))
            part_tables.append(f"part_{i}")
        union = " UNION ALL ".join(f"SELECT * FROM {t}" for t in part_tables)
        pos = " OR ".join(f"coalesce({m}, 0) > 0" for m in MEASURE_COLS)
        q = (f"SELECT * FROM ({union}) WHERE {pos} "
             "ORDER BY link_id, truck_type, market, commodity_group")
        dest = ctx.paths.out / "network" / "link_flows" / f"{year}.parquet"
        rows = write_parquet(con, q, dest)
        links_with_flow = con.execute(f"SELECT count(DISTINCT link_id) FROM read_parquet({sql_literal(dest.as_posix())})").fetchone()[0]
        stats[year] = {"rows": rows, "links_with_flow": links_with_flow}
        log(f"  link flows {year}: {rows} rows, {links_with_flow} links with flow, {dest.stat().st_size / 1e6:.2f} MB")
    return stats


def _extract_csv(ctx: Context, zip_path: Path, member_dir: str, fname: str) -> Path:
    return extract_member(zip_path, member_dir.rstrip("/") + "/" + fname, ctx.paths.extract / "network")


def build(ctx: Context, log=print) -> dict[str, Any]:
    con = connect(spatial=True)
    attrs = _links_table(ctx, con)
    stats = _clip(ctx, con)
    out = ctx.paths.out / "network"
    out.mkdir(parents=True, exist_ok=True)
    attr_sql = ", ".join(f"l.{a}" for a in attrs)
    write_parquet(con, f"SELECT {attr_sql}, (l.state_fips = {sql_literal(ctx.state.fips)}) AS in_state "
                       "FROM links l JOIN clip c USING (link_id) ORDER BY l.link_id", out / "link_attrs.parquet")
    # PMTiles: only what styling/filtering needs; flows join client-side by `id`.
    geo = ctx.sources["geo"]
    pm = out / f"{ctx.state.slug}_network.pmtiles"
    if pm.exists():
        pm.unlink()
    con.execute(
        "COPY (SELECT l.link_id AS id, l.road_class AS cls, l.f_class AS fc, l.nhs AS nhs, l.nhfn AS nhfn, l.strahnet AS strahnet, "
        "l.dir AS dir, l.geom AS geom FROM links l JOIN clip c USING (link_id) ORDER BY l.link_id) "
        f"TO {sql_literal(pm.as_posix())} WITH (FORMAT GDAL, DRIVER 'PMTiles', "
        f"DATASET_CREATION_OPTIONS ('MINZOOM={geo['pmtiles_minzoom']}', 'MAXZOOM={geo['pmtiles_maxzoom']}'), "
        "LAYER_CREATION_OPTIONS ('NAME=faf5_links'))")
    stats["pmtiles_bytes"] = pm.stat().st_size
    log(f"  clip: {stats['links_in_clip']} links ({stats['links_in_state']} in state, buffer {stats['buffer_km']} km); "
        f"pmtiles {pm.stat().st_size / 1e6:.2f} MB")
    stats["flows"] = _link_flows(ctx, con, log)
    return stats
