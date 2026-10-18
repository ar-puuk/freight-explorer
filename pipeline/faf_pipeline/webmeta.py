"""Small JSON files the web app needs before DuckDB-WASM is ready: labels for the controls and a headline-flow file for first paint."""

from __future__ import annotations

from typing import Any

import yaml

from faf_pipeline.config import Context
from faf_pipeline.duck import connect, sql_literal, write_json

HEADLINE_FLOWS = 60


def default_year(data_version: dict[str, Any], years: list[int]) -> int:
    """Latest final annual estimate; if a version has none, its base year."""
    finals = [y for y in years if y in (data_version.get("final") or [])]
    if finals:
        return max(finals)
    bases = [y for y in years if y in (data_version.get("base") or [])]
    if bases:
        return max(bases)
    return min(years)


def build(ctx: Context, log=print) -> None:
    out = ctx.paths.out
    con = connect()
    meta = out / "meta"

    def dim(name: str, code: str) -> dict[str, dict[str, Any]]:
        res: dict[str, dict[str, Any]] = {}
        for ver, c, label in con.execute(f"SELECT faf_version, {code}, label FROM read_parquet({sql_literal((meta / (name + '.parquet')).as_posix())}) "
                                         "ORDER BY faf_version, 2").fetchall():
            res.setdefault(ver, {})[str(c)] = label
        return res

    groups = yaml.safe_load((ctx.paths.schemas / "network_groups.yml").read_text(encoding="utf-8"))["groups"]
    versions: dict[str, Any] = {}
    commodity, mode = dim("dim_commodity", "sctg2"), dim("dim_mode", "mode")
    trade, foreign, band = dim("dim_trade_type", "trade_type"), dim("dim_foreign_region", "region_id"), dim("dim_dist_band", "dist_band")
    states = dim("dim_state", "state_fips")
    for ver in commodity:
        versions[ver] = {"commodity": commodity[ver], "mode": mode[ver], "trade_type": trade[ver], "foreign": foreign[ver], "dist_band": band.get(ver, {})}
    cs = ctx.sources["products"].get("county")
    if cs and cs["faf_version"] in versions:
        # the county product has five commodity groups of its own; each is its own (single-code) group in the UI
        versions[cs["faf_version"]]["commodity_groups"] = [{"name": lab, "slug": code, "sctg": [code]} for code, lab in cs["dims"]["commodity"].items()]
    write_json({
        "versions": versions,
        # commodity groupings are the 12 FHWA assignment groups (SCTG membership from the FHWA data dictionary)
        "commodity_groups": [{"name": n, "slug": g["slug"], "sctg": g["sctg"]} for n, g in groups.items()],
        "states": next(iter(states.values())) if states else {},
    }, meta / "dims.json")

    for p in ("faf5", "faf6"):
        spec = ctx.sources["products"][p]
        files = sorted((out / p / "flows" / spec["scenario"]).glob("*.parquet"))
        if not files:
            continue
        years = sorted(int(f.stem) for f in files)
        y = default_year(spec["data_version"], years)
        src = sql_literal((out / p / "flows" / spec["scenario"] / f"{y}.parquet").as_posix())
        rows = con.execute(
            f"SELECT dms_orig, dms_dest, sum(tons_kt) AS t FROM read_parquet({src}) GROUP BY 1, 2 HAVING sum(tons_kt) > 0 "
            "ORDER BY t DESC, dms_orig, dms_dest LIMIT ?", [HEADLINE_FLOWS]).fetchall()
        total_n, total_t = con.execute(
            f"SELECT count(*), sum(t) FROM (SELECT sum(tons_kt) AS t FROM read_parquet({src}) GROUP BY dms_orig, dms_dest HAVING sum(tons_kt) > 0)").fetchone()
        write_json({
            "faf_version": spec["faf_version"], "year": y, "view": "total", "direction": "both", "measure": "tons_kt",
            "flows_total": total_n, "tons_kt_total": total_t,
            "flows": [[o, d, round(t, 3)] for o, d, t in rows],
        }, out / p / "headline_flows.json")
        log(f"  {p}: headline flows for {y} ({len(rows)} of {total_n})")
