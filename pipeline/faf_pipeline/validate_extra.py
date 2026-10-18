"""Validation for the history series and the experimental county product (called from validate.run)."""

from __future__ import annotations

import json
from typing import Any

from faf_pipeline.config import Context
from faf_pipeline.duck import sql_literal

TRADE_CONSISTENCY = """SELECT count(*) FROM read_parquet({g}) WHERE
    (trade_type = 1 AND (fr_orig IS NOT NULL OR fr_dest IS NOT NULL OR fr_inmode IS NOT NULL OR fr_outmode IS NOT NULL))
 OR (trade_type = 2 AND (fr_orig IS NULL OR fr_inmode IS NULL OR fr_dest IS NOT NULL OR fr_outmode IS NOT NULL))
 OR (trade_type = 3 AND (fr_dest IS NULL OR fr_outmode IS NULL OR fr_orig IS NOT NULL OR fr_inmode IS NOT NULL))"""


def _dim(out, name: str) -> str:
    return sql_literal((out / "meta" / f"{name}.parquet").as_posix())


def check_history(ctx: Context, con, fails: list[str], report: dict[str, Any]) -> None:
    out = ctx.paths.out
    d = out / "history" / "state_flows" / "mid"
    files = sorted(d.glob("*.parquet"))
    if not files:
        return
    g = sql_literal(d.as_posix() + "/*.parquet")
    v = sql_literal(ctx.sources["products"]["history"]["faf_version"])
    keys = "year, fr_orig, dms_orig_st, dms_dest_st, fr_dest, fr_inmode, dms_mode, fr_outmode, sctg2, trade_type"
    if con.execute(f"SELECT count(*) FROM (SELECT 1 FROM read_parquet({g}) GROUP BY {keys} HAVING count(*) > 1)").fetchone()[0]:
        fails.append("history: duplicate keys")
    neg = con.execute(f"SELECT count(*) FROM read_parquet({g}) WHERE tons_kt < 0 OR value_const_musd < 0 OR value_current_musd < 0 OR tmiles_m < 0").fetchone()[0]
    if neg:
        fails.append(f"history: {neg} rows with negative measures")
    for col, dname, dcol in (("sctg2", "dim_commodity", "sctg2"), ("dms_mode", "dim_mode", "mode"), ("trade_type", "dim_trade_type", "trade_type"),
                             ("fr_inmode", "dim_mode", "mode"), ("fr_outmode", "dim_mode", "mode"), ("fr_orig", "dim_foreign_region", "region_id"),
                             ("fr_dest", "dim_foreign_region", "region_id"), ("dms_orig_st", "dim_state", "state_fips"), ("dms_dest_st", "dim_state", "state_fips")):
        bad = con.execute(f"SELECT count(DISTINCT {col}) FROM read_parquet({g}) WHERE {col} IS NOT NULL AND {col} NOT IN "
                          f"(SELECT {dcol} FROM read_parquet({_dim(out, dname)}) WHERE faf_version = {v})").fetchone()[0]
        if bad:
            fails.append(f"history: {bad} {col} codes not in {dname}")
    if con.execute(TRADE_CONSISTENCY.format(g=g)).fetchone()[0]:
        fails.append("history: trade-type/foreign-field consistency violated")
    fips = sql_literal(ctx.state.fips)
    if con.execute(f"SELECT count(*) FROM read_parquet({g}) WHERE dms_orig_st <> {fips} AND dms_dest_st <> {fips}").fetchone()[0]:
        fails.append("history: rows that do not touch the state")
    if con.execute(f"SELECT count(*) FROM read_parquet({g}) WHERE data_version <> 'historical'").fetchone()[0]:
        fails.append("history: data_version must be 'historical'")
    # report only: the history series is designed to precede FAF5's 2017 base year; show the step, never a pass/fail
    tot = {int(y): t for y, t in con.execute(f"SELECT year, sum(tons_kt) FROM read_parquet({g}) WHERE trade_type = 1 GROUP BY 1 ORDER BY 1").fetchall()}
    f5 = out / "faf5" / "state_flows" / "mid" / "2017.parquet"
    if f5.exists():
        t17 = con.execute(f"SELECT sum(tons_kt) FROM read_parquet({sql_literal(f5.as_posix())}) WHERE trade_type = 1").fetchone()[0]
        report["history: domestic-touching tons (kt) by year, then FAF5.7.1 2017 (report only)"] = {**tot, 2017: t17}


def check_county(ctx: Context, con, fails: list[str], report: dict[str, Any]) -> None:
    out = ctx.paths.out
    d = out / "county" / "flows" / "mid"
    files = sorted(d.glob("*.parquet"))
    if not files:
        return
    g = sql_literal(d.as_posix() + "/*.parquet")
    spec = ctx.sources["products"]["county"]
    v = sql_literal(spec["faf_version"])
    keys = "table_kind, trade_type, fr_orig, fr_inmode, fr_dest, fr_outmode, dms_orig, dms_dest, sctg2, dms_mode"
    if con.execute(f"SELECT count(*) FROM (SELECT 1 FROM read_parquet({g}) GROUP BY {keys} HAVING count(*) > 1)").fetchone()[0]:
        fails.append("county: duplicate keys")
    if con.execute(f"SELECT count(*) FROM read_parquet({g}) WHERE tons_kt < 0 OR tons_kt IS NULL").fetchone()[0]:
        fails.append("county: negative or missing tons")
    if con.execute(f"SELECT count(*) FROM read_parquet({g}) WHERE value_const_musd IS NOT NULL OR value_current_musd IS NOT NULL OR tmiles_m IS NOT NULL").fetchone()[0]:
        fails.append("county: the county product is tons only, but value or ton-mile columns hold data")
    f5 = sql_literal(ctx.sources["products"]["faf5"]["faf_version"])
    # the domestic mode and commodity codes are the county product's own; foreign-leg modes and regions are the regular FAF ones
    for col, dname, dcol, ver in (("sctg2", "dim_commodity", "sctg2", v), ("dms_mode", "dim_mode", "mode", v), ("trade_type", "dim_trade_type", "trade_type", v),
                                  ("fr_orig", "dim_foreign_region", "region_id", v), ("fr_dest", "dim_foreign_region", "region_id", v),
                                  ("fr_inmode", "dim_mode", "mode", f5), ("fr_outmode", "dim_mode", "mode", f5)):
        bad = con.execute(f"SELECT count(DISTINCT {col}) FROM read_parquet({g}) WHERE {col} IS NOT NULL AND {col} NOT IN "
                          f"(SELECT {dcol} FROM read_parquet({_dim(out, dname)}) WHERE faf_version = {ver})").fetchone()[0]
        if bad:
            fails.append(f"county: {bad} {col} codes not in {dname}")
    if con.execute(TRADE_CONSISTENCY.format(g=g)).fetchone()[0]:
        fails.append("county: trade-type/foreign-field consistency violated")
    locs = json.loads((out / "geo" / "county_locations.json").read_text(encoding="utf-8"))
    ids = {x["id"] for x in locs}
    bad = con.execute(f"SELECT count(*) FROM read_parquet({g}) WHERE dms_orig NOT IN ({', '.join(sql_literal(i) for i in ids)}) OR dms_dest NOT IN ({', '.join(sql_literal(i) for i in ids)})").fetchone()[0]
    if bad:
        fails.append(f"county: {bad} rows with an endpoint that has no location")
    fips = sql_literal(ctx.state.fips)
    if con.execute(f"SELECT count(*) FROM read_parquet({g}) WHERE left(dms_orig, 2) <> {fips} AND left(dms_dest, 2) <> {fips}").fetchone()[0]:
        fails.append("county: rows that do not touch the state")
    # table_kind semantics: zone endpoints (3 characters) only where the table says so
    if con.execute(f"SELECT count(*) FROM read_parquet({g}) WHERE (table_kind = 'c2c' AND (length(dms_orig) <> 5 OR length(dms_dest) <> 5)) "
                   "OR (table_kind = 'c2f' AND (length(dms_orig) <> 5 OR length(dms_dest) <> 3)) OR (table_kind = 'f2c' AND (length(dms_orig) <> 3 OR length(dms_dest) <> 5))").fetchone()[0]:
        fails.append("county: endpoint kinds do not match table_kind")
    fac = out / "county" / "factors.parquet"
    if fac.exists():
        bad = con.execute(f"SELECT count(*) FROM (SELECT 1 FROM read_parquet({sql_literal(fac.as_posix())}) GROUP BY mode_group, direction, faf_zone, commodity_group "
                          "HAVING abs(sum(factor) - 1) > 1e-5)").fetchone()[0]
        if bad:
            fails.append(f"county factors: {bad} sets do not sum to 1")
    # Conservation: the county estimates disaggregate FAF flows, so domestic tons by mode must reproduce the FAF5.7.1 2022 state totals
    # (mode 11 = FAF truck + air). Tolerance 1%: BTS built them from FAF5.6.1 and 2022 was already final there.
    f5file = out / "faf5" / "state_flows" / "mid" / "2022.parquet"
    if f5file.exists():
        cmp_rows = con.execute(f"""WITH c AS (SELECT dms_mode AS m, sum(tons_kt) AS t FROM read_parquet({g}) WHERE trade_type = 1 GROUP BY 1),
              f AS (SELECT CASE WHEN dms_mode IN (1, 4) THEN 11 ELSE dms_mode END AS m, sum(tons_kt) AS t FROM read_parquet({sql_literal(f5file.as_posix())})
                    WHERE trade_type = 1 AND dms_mode IN (1, 2, 3, 4, 5, 6) GROUP BY 1)
              SELECT coalesce(c.m, f.m), c.t, f.t FROM c FULL JOIN f ON c.m = f.m ORDER BY 1""").fetchall()
        report["county vs FAF5.7.1 2022 domestic tons by county mode (kt): mode, county, FAF5"] = [(int(m), round(a or 0, 1), round(b or 0, 1)) for m, a, b in cmp_rows]
        for m, a, b in cmp_rows:
            if abs((a or 0) - (b or 0)) > 0.01 * max(abs(b or 0), 1.0):
                fails.append(f"county: domestic tons for mode {int(m)} are {a} but FAF5.7.1 2022 has {b} (>1% apart); the county estimates should conserve FAF totals")
    # report only, never merged: county-estimate 2022 vs FAF 2022 domestic tons touching the state
    rep: dict[str, Any] = {"county-exp 2022 (FAF5.6.1-based, experimental)": con.execute(f"SELECT round(sum(tons_kt)) FROM read_parquet({g}) WHERE trade_type = 1").fetchone()[0]}
    for p in ("faf5", "faf6"):
        f = out / p / "state_flows" / "mid" / "2022.parquet"
        if f.exists():
            rep[f"FAF {ctx.sources['products'][p]['faf_version']} 2022"] = con.execute(f"SELECT round(sum(tons_kt)) FROM read_parquet({sql_literal(f.as_posix())}) WHERE trade_type = 1").fetchone()[0]
    report["county vs FAF 2022 domestic-touching tons, kt (report only, never merged)"] = rep
