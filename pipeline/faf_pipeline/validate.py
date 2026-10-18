"""Output validation. `run` returns (failures, report); failures must be empty before processed data is committed."""

from __future__ import annotations

import gzip
import json
import re
import struct
from pathlib import Path
from typing import Any

from faf_pipeline import dictionary
from faf_pipeline.config import Context
from faf_pipeline.duck import connect, sql_literal

MAX_BYTES = 90 * 1024 * 1024
FLOW_KEYS = ["fr_orig", "dms_orig", "dms_dest", "fr_dest", "fr_inmode", "dms_mode", "fr_outmode", "sctg2", "trade_type", "dist_band"]
STATE_KEYS = ["fr_orig", "dms_orig_st", "dms_dest_st", "fr_dest", "fr_inmode", "dms_mode", "fr_outmode", "sctg2", "trade_type", "dist_band"]
MEASURES = ("tons_kt", "value_const_musd", "value_current_musd", "tmiles_m")
ROW_DROP_FAIL = 0.05          # a >5% drop in rows vs the previous build fails
SWING_FLAG = 0.25             # annual-estimate year-over-year swing flagged (report only)


def _cols(con, path: str) -> list[str]:
    return [r[0] for r in con.execute(f"SELECT column_name FROM (DESCRIBE SELECT * FROM read_parquet({path}))").fetchall()]


def _glob(d: Path) -> str:
    return sql_literal(d.as_posix() + "/*.parquet")


def check_pmtiles(path: Path) -> dict[str, Any]:
    b = path.read_bytes()
    if b[:7] != b"PMTiles" or b[7] != 3:
        raise ValueError("not a PMTiles v3 archive")
    meta_off, meta_len = struct.unpack_from("<QQ", b, 24)
    internal_comp = b[97]
    raw = b[meta_off:meta_off + meta_len]
    meta = json.loads(gzip.decompress(raw) if internal_comp == 2 else raw)
    min_lon, min_lat, max_lon, max_lat = (v / 1e7 for v in struct.unpack_from("<iiii", b, 102))
    return {"layers": [layer["id"] for layer in meta.get("vector_layers", [])], "bounds": (min_lon, min_lat, max_lon, max_lat),
            "minzoom": b[100], "maxzoom": b[101]}


def run(ctx: Context, previous_versions: dict[str, Any] | None = None, log=print) -> tuple[list[str], dict[str, Any]]:
    fails: list[str] = []
    report: dict[str, Any] = {}
    out = ctx.paths.out
    con = connect()
    products = [p for p in ("faf5", "faf6") if (out / p / "flows").exists()]

    def dim(name: str) -> str:
        return sql_literal((out / "meta" / f"{name}.parquet").as_posix())

    # ---- per product flows
    for p in products:
        spec = ctx.sources["products"][p]
        v = sql_literal(spec["faf_version"])
        for folder, keys in (("flows", FLOW_KEYS), ("state_flows", STATE_KEYS)):
            d = out / p / folder / spec["scenario"]
            files = sorted(d.glob("*.parquet"))
            if not files:
                fails.append(f"{p}/{folder}: no files")
                continue
            have = _cols(con, sql_literal(files[0].as_posix()))
            kc = [k for k in keys if k in have]
            g = _glob(d)
            tag = f"{p}/{folder}"
            dups = con.execute(f"SELECT count(*) FROM (SELECT 1 FROM read_parquet({g}) GROUP BY year, {', '.join(kc)} HAVING count(*) > 1)").fetchone()[0]
            if dups:
                fails.append(f"{tag}: {dups} duplicate keys")
            neg = con.execute("SELECT count(*) FROM read_parquet(%s) WHERE %s" % (g, " OR ".join(f"{m} < 0" for m in MEASURES))).fetchone()[0]
            if neg:
                fails.append(f"{tag}: {neg} rows with negative measures")
            # codes in dimensions
            checks = [("sctg2", "dim_commodity", "sctg2"), ("dms_mode", "dim_mode", "mode"), ("trade_type", "dim_trade_type", "trade_type")]
            if "dist_band" in have:
                checks.append(("dist_band", "dim_dist_band", "dist_band"))
            for col, dname, dcol in checks:
                bad = con.execute(f"SELECT count(DISTINCT {col}) FROM read_parquet({g}) WHERE {col} IS NOT NULL AND {col} NOT IN "
                                  f"(SELECT {dcol} FROM read_parquet({dim(dname)}) WHERE faf_version = {v})").fetchone()[0]
                if bad:
                    fails.append(f"{tag}: {bad} {col} codes not in {dname}")
            for col in ("fr_inmode", "fr_outmode"):
                bad = con.execute(f"SELECT count(DISTINCT {col}) FROM read_parquet({g}) WHERE {col} IS NOT NULL AND {col} NOT IN "
                                  f"(SELECT mode FROM read_parquet({dim('dim_mode')}) WHERE faf_version = {v})").fetchone()[0]
                if bad:
                    fails.append(f"{tag}: {bad} {col} codes not in dim_mode")
            for col in ("fr_orig", "fr_dest"):
                bad = con.execute(f"SELECT count(DISTINCT {col}) FROM read_parquet({g}) WHERE {col} IS NOT NULL AND {col} NOT IN "
                                  f"(SELECT region_id FROM read_parquet({dim('dim_foreign_region')}) WHERE faf_version = {v})").fetchone()[0]
                if bad:
                    fails.append(f"{tag}: {bad} {col} codes not in dim_foreign_region")
            if folder == "flows":
                for col in ("dms_orig", "dms_dest"):
                    bad = con.execute(f"SELECT count(DISTINCT {col}) FROM read_parquet({g}) WHERE {col} NOT IN "
                                      f"(SELECT zone_id FROM read_parquet({dim('dim_zone')}) WHERE faf_version = {v})").fetchone()[0]
                    if bad:
                        fails.append(f"{tag}: {bad} {col} zone ids not in dim_zone")
            # trade-type consistency
            bad = con.execute(f"""SELECT count(*) FROM read_parquet({g}) WHERE
                (trade_type = 1 AND (fr_orig IS NOT NULL OR fr_dest IS NOT NULL OR fr_inmode IS NOT NULL OR fr_outmode IS NOT NULL))
             OR (trade_type = 2 AND (fr_orig IS NULL OR fr_inmode IS NULL OR fr_dest IS NOT NULL OR fr_outmode IS NOT NULL))
             OR (trade_type = 3 AND (fr_dest IS NULL OR fr_outmode IS NULL OR fr_orig IS NOT NULL OR fr_inmode IS NOT NULL))""").fetchone()[0]
            if bad:
                fails.append(f"{tag}: {bad} rows violate trade-type/foreign-field consistency")
            # NULL patterns (report)
            report[f"{tag}:null_measure_years"] = {
                m: [r[0] for r in con.execute(f"SELECT year FROM read_parquet({g}) GROUP BY year HAVING count({m}) = 0 ORDER BY year").fetchall()]
                for m in MEASURES}
            # row counts vs previous build
            prev = ((previous_versions or {}).get("products", {}).get(p, {}).get("rows", {}))
            for f in files:
                key = f"{folder}/{f.stem}"
                now = con.execute(f"SELECT count(*) FROM read_parquet({sql_literal(f.as_posix())})").fetchone()[0]
                if key in prev and prev[key] > 0 and now < prev[key] * (1 - ROW_DROP_FAIL):
                    fails.append(f"{tag}/{f.stem}: rows dropped from {prev[key]} to {now} (>{ROW_DROP_FAIL:.0%})")

        # reconciliation regional -> state, every year
        gr, gs = _glob(out / p / "flows" / spec["scenario"]), _glob(out / p / "state_flows" / spec["scenario"])
        have_r = _cols(con, sql_literal(sorted((out / p / "flows" / spec["scenario"]).glob("*.parquet"))[0].as_posix()))
        # NULL key parts are coalesced to sentinels so the join treats "not applicable" as a value
        kn = "coalesce(fr_orig, '') AS fr_orig, {o} AS o, {d} AS d, coalesce(fr_dest, '') AS fr_dest, coalesce(fr_inmode, -1) AS fr_inmode, "              "dms_mode, coalesce(fr_outmode, -1) AS fr_outmode, sctg2, trade_type, coalesce({db}, -1) AS dist_band"
        db_expr = "dist_band" if "dist_band" in have_r else "CAST(NULL AS SMALLINT)"
        con.execute(f"""CREATE OR REPLACE TABLE r_agg AS SELECT year, {kn.format(o='left(dms_orig, 2)', d='left(dms_dest, 2)', db=db_expr)},
            sum(tons_kt) AS t, sum(value_const_musd) AS v, sum(value_current_musd) AS c, sum(tmiles_m) AS m FROM read_parquet({gr}) GROUP BY ALL""")
        con.execute(f"""CREATE OR REPLACE TABLE s_flat AS SELECT year, {kn.format(o='dms_orig_st', d='dms_dest_st', db=db_expr)},
            tons_kt AS t, value_const_musd AS v, value_current_musd AS c, tmiles_m AS m FROM read_parquet({gs})""")
        join = "year, fr_orig, o, d, fr_dest, fr_inmode, dms_mode, fr_outmode, sctg2, trade_type, dist_band"
        tol = 1e-6
        row = con.execute(f"""SELECT count(*) FILTER (WHERE r_agg.year IS NULL OR s_flat.year IS NULL) AS unmatched,
                count(*) FILTER (WHERE r_agg.year IS NOT NULL AND s_flat.year IS NOT NULL AND (
                   abs(coalesce(r_agg.t,0) - coalesce(s_flat.t,0)) > {tol} OR abs(coalesce(r_agg.v,0) - coalesce(s_flat.v,0)) > {tol}
                   OR abs(coalesce(r_agg.c,0) - coalesce(s_flat.c,0)) > {tol} OR abs(coalesce(r_agg.m,0) - coalesce(s_flat.m,0)) > {tol})) AS diff,
                count(*) AS total
            FROM r_agg FULL OUTER JOIN s_flat USING ({join})""").fetchone()
        report[f"{p}:reconciliation"] = {"rows_compared": row[2], "unmatched": row[0], "value_mismatches": row[1], "tolerance": tol}
        if row[0] or row[1]:
            fails.append(f"{p}: regional vs state reconciliation: {row[0]} unmatched rows, {row[1]} mismatching rows (of {row[2]})")

        # year-over-year swings (report only); forecast steps separate
        rows = con.execute(f"""SELECT year, any_value(data_version), sum(tons_kt) FROM read_parquet({gs}) WHERE trade_type = 1 GROUP BY year ORDER BY year""").fetchall()
        swings = []
        for (y0, dv0, t0), (y1, dv1, t1) in zip(rows, rows[1:]):
            if t0 and abs(t1 / t0 - 1) > SWING_FLAG and dv1 != "forecast" and dv0 != "forecast":
                swings.append(f"{y0}->{y1}: {t1 / t0 - 1:+.0%}")
        report[f"{p}:annual_swings_over_{int(SWING_FLAG * 100)}pct"] = swings

    # ---- FAF5 vs FAF6 2022 (report only)
    if len(products) == 2:
        cmp_: dict[str, Any] = {}
        for p in products:
            spec = ctx.sources["products"][p]
            f = out / p / "state_flows" / spec["scenario"] / "2022.parquet"
            if f.exists():
                cmp_[spec["faf_version"]] = {int(tt): {"tons_kt": t, "value_const_musd": v} for tt, t, v in con.execute(
                    f"SELECT trade_type, sum(tons_kt), sum(value_const_musd) FROM read_parquet({sql_literal(f.as_posix())}) GROUP BY 1 ORDER BY 1").fetchall()}
        report["faf5_vs_faf6_2022_state_touching_by_trade_type (report only, never merged)"] = cmp_

    # ---- network
    net = out / "network"
    if (net / "link_attrs.parquet").exists():
        la, lf = sql_literal((net / "link_attrs.parquet").as_posix()), _glob(net / "link_flows")
        orphans = con.execute(f"SELECT count(DISTINCT link_id) FROM read_parquet({lf}) WHERE link_id NOT IN (SELECT link_id FROM read_parquet({la}))").fetchone()[0]
        if orphans:
            fails.append(f"network: {orphans} link_flows link ids missing from link_attrs")
        neg = con.execute(f"SELECT count(*) FROM read_parquet({la}) WHERE length_mi < 0").fetchone()[0]
        neg += con.execute("SELECT count(*) FROM read_parquet(%s) WHERE %s" % (lf, " OR ".join(f"{m} < 0" for m in
                           ("ab_tons_k", "ba_tons_k", "tot_tons_k", "ab_trips_day", "ba_trips_day", "tot_trips_day")))).fetchone()[0]
        if neg:
            fails.append(f"network: {neg} negative lengths or flows")
        dups = con.execute(f"SELECT count(*) FROM (SELECT 1 FROM read_parquet({lf}) GROUP BY year, link_id, truck_type, market, commodity_group HAVING count(*) > 1)").fetchone()[0]
        if dups:
            fails.append(f"network: {dups} duplicate link_flows keys")
        n_links = con.execute(f"SELECT count(*) FROM read_parquet({la})").fetchone()[0]
        cov = {int(y): n for y, n in con.execute(f"SELECT year, count(DISTINCT link_id) FROM read_parquet({lf}) GROUP BY 1 ORDER BY 1").fetchall()}
        report["network:link_coverage"] = {"links_in_clip": n_links, "links_with_flow_by_year": cov}
        pm = net / f"{ctx.state.slug}_network.pmtiles"
        try:
            info = check_pmtiles(pm)
            if "faf5_links" not in info["layers"]:
                fails.append(f"network: pmtiles layers {info['layers']}, expected faf5_links")
            # links that merely touch the buffer can extend well past it, so the check is deliberately loose:
            # it exists to catch a wrong clip (e.g. the whole country), not to measure the buffer.
            slack = max(4 * ctx.state.network_buffer_km / 111.0, 1.0)
            w, s, e, n = ctx.state.bbox
            b = info["bounds"]
            if not (b[0] >= w - slack and b[1] >= s - slack and b[2] <= e + slack and b[3] <= n + slack):
                fails.append(f"network: pmtiles bounds {b} outside state bbox + {slack:.2f} deg")
            report["network:pmtiles"] = info
        except Exception as ex:      # noqa: BLE001
            fails.append(f"network: pmtiles check failed: {ex}")

    # ---- coordinates: state zones' anchors inside bbox (+ buffer)
    dz = out / "meta" / "dim_zone.parquet"
    if dz.exists():
        w, s, e, n = ctx.state.bbox
        pad = ctx.state.network_buffer_km / 111.0
        bad = con.execute(f"SELECT count(*) FROM read_parquet({sql_literal(dz.as_posix())}) WHERE is_state_zone AND NOT "
                          f"(anchor_lon BETWEEN {w - pad} AND {e + pad} AND anchor_lat BETWEEN {s - pad} AND {n + pad})").fetchone()[0]
        if bad:
            fails.append(f"zones: {bad} state zone anchors outside the state bbox + buffer")

    # ---- file sizes
    big = [f"{p.relative_to(out)} ({p.stat().st_size} bytes)" for p in out.rglob("*") if p.is_file() and p.stat().st_size >= MAX_BYTES]
    if big:
        fails.append("files >= 90 MB: " + ", ".join(big))

    # ---- dictionary
    miss = dictionary.missing_entries(ctx)
    if miss:
        fails.append("columns without dictionary entry: " + ", ".join(miss))
    dpq = out / "meta" / "dictionary.parquet"
    if not dpq.exists():
        fails.append("meta/dictionary.parquet missing")

    # ---- no state literal in code
    fails += scan_state_literals(ctx)
    return fails, report


_CODE_GLOBS = ("pipeline/faf_pipeline/**/*.py", "pipeline/faf_pipeline/**/*.sql", "pipeline/faf_pipeline/**/*.yml",
               "pipeline/tests/**/*.py", "web/src/**/*.ts", "web/src/**/*.svelte", "web/*.html", "web/*.ts", "config/sources.yml", "config/app.yml")


def scan_state_literals(ctx: Context) -> list[str]:
    """The configured state's name, abbreviation, FIPS and derived zone ids must not appear as literals in code."""
    from faf_pipeline.dims import state_zone_ids
    s = ctx.state
    zone_ids = sorted({z for p in ("faf5", "faf6") for z in state_zone_ids(ctx, p)})
    pats = [(re.compile(rf"\b{re.escape(s.name)}\b", re.IGNORECASE), f"state name {s.name!r}"),
            (re.compile(rf"""['"]{re.escape(s.abbrev)}['"]"""), f"abbreviation {s.abbrev!r}"),
            (re.compile(rf"""['"]{re.escape(s.fips)}['"]"""), f"fips {s.fips!r}")]
    pats += [(re.compile(rf"""['"]{z}['"]"""), f"zone id {z!r}") for z in zone_ids]
    hits = []
    seen: set[Path] = set()
    for g in _CODE_GLOBS:
        for f in ctx.paths.root.glob(g):
            if f in seen or not f.is_file() or "node_modules" in f.parts:
                continue
            seen.add(f)
            text = f.read_text(encoding="utf-8", errors="ignore")
            for rx, what in pats:
                m = rx.search(text)
                if m:
                    hits.append(f"state literal in {f.relative_to(ctx.paths.root).as_posix()}: {what}")
    return hits
