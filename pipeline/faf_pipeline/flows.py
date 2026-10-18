"""FAF origin-destination flows: guard the schema, filter to the state, unpivot wide years, write Parquet per year."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from faf_pipeline.config import ConfigError, Context
from faf_pipeline.dims import state_zone_ids
from faf_pipeline.duck import connect, render, sql_literal, write_parquet
from faf_pipeline.fetch import extracted
from faf_pipeline.schema import Schema, check_header, load_schema

MEASURES = ("tons_kt", "value_const_musd", "value_current_musd", "tmiles_m")


def classify_year(spec: dict[str, Any], year: int, product: str) -> str:
    dv = spec["data_version"]
    for label in ("base", "final", "preliminary", "historical"):
        if year in (dv.get(label) or []):
            return label
    if "forecast_from" in dv and year >= dv["forecast_from"]:
        return "forecast"
    raise ConfigError(f"{product}: year {year} appears in the data but is not classified in config/sources.yml "
                      "(data_version: base/final/preliminary/forecast_from). Check the BTS version history and add it.")


def _typed(col: str, typ: str) -> str:
    c = f'NULLIF("{col}", \'\')'
    return {
        "varchar": c,
        "smallint": f"CAST({c} AS SMALLINT)",
        "zone3": f"lpad({c}, 3, '0')",
        "state2": f"lpad({c}, 2, '0')",
        "county5": f"lpad({c}, 5, '0')",
        "code2": f"lpad({c}, 2, '0')",
    }[typ]


def _read_header(con, csv: Path) -> list[str]:
    rel = con.execute(f"SELECT * FROM read_csv({sql_literal(csv.as_posix())}, all_varchar = true, header = true) LIMIT 0")
    return [d[0] for d in rel.description]


def build_level(ctx: Context, product: str, level: str, log=print, hilo: bool = False) -> dict[str, Any]:
    """Build one level ('regional' or 'state') of one product. `hilo` reads the High/Low file and writes the high and
    low scenarios (forecast years only); otherwise the mid-range file. Returns stats for the changelog/validation."""
    spec = ctx.sources["products"][product]
    file_key = f"{level}_hilo" if hilo else level
    fspec = spec["files"][file_key]
    schema = load_schema(ctx, fspec["schema"])
    csv = extracted(ctx, product, file_key)
    con = connect()
    header = _read_header(con, csv)
    chk = check_header(schema, header)
    years = chk.years
    year_list = sorted(years)
    # (scenario, year) slices to write: mid-range file -> mid; Hi/Lo file -> each scenario's years (its plain columns are the mid
    # range, which is not rewritten here, only cross-checked against the mid-range files)
    slices = [(spec["scenario"], y) for y in year_list] if not hilo else [(sc, y) for sc in schema.scenarios for y in sorted(chk.scenario_years[sc])]
    statuses = {y: classify_year(spec, y, product) for _, y in slices}

    keys = [(src, c["canonical"], c["type"]) for src, c in schema.columns.items()]
    canon = [k[1] for k in keys]
    sel = [f"  {_typed(src, typ)} AS {name}" for src, name, typ in keys]
    for y in year_list:
        for prefix, measure in schema.year_columns.items():
            col = years[y].get(prefix)
            sel.append(f"  TRY_CAST(\"{col}\" AS DOUBLE) AS {measure}_{y}" if col else f"  CAST(NULL AS DOUBLE) AS {measure}_{y}")
    for sc, ymap in chk.scenario_years.items():
        for y, cols in sorted(ymap.items()):
            for prefix, measure in schema.scenario_prefixes.items():
                sel.append(f"  TRY_CAST(\"{cols[prefix]}\" AS DOUBLE) AS {measure}_{y}_{sc}")

    if level == "regional":
        zones = state_zone_ids(ctx, product)
        inlist = ", ".join(sql_literal(z) for z in zones)
        where = f"lpad(NULLIF(\"{_src(schema, 'dms_orig')}\", ''), 3, '0') IN ({inlist}) OR lpad(NULLIF(\"{_src(schema, 'dms_dest')}\", ''), 3, '0') IN ({inlist})"
        is_orig, is_dest = f"dms_orig IN ({inlist})", f"dms_dest IN ({inlist})"
    else:
        fips = sql_literal(ctx.state.fips)
        where = f"lpad(NULLIF(\"{_src(schema, 'dms_orig_st')}\", ''), 2, '0') = {fips} OR lpad(NULLIF(\"{_src(schema, 'dms_dest_st')}\", ''), 2, '0') = {fips}"
        is_orig, is_dest = f"dms_orig_st = {fips}", f"dms_dest_st = {fips}"

    con.execute(render(ctx.paths.sql / "state_filter.sql", select_list=",\n".join(sel),
                       csv_path=sql_literal(csv.as_posix()), where=where))
    n = con.execute("SELECT count(*) FROM touching").fetchone()[0]
    inbound = con.execute(f"SELECT count(*) FROM touching WHERE NOT ({is_orig}) AND ({is_dest})").fetchone()[0]
    outbound = con.execute(f"SELECT count(*) FROM touching WHERE ({is_orig}) AND NOT ({is_dest})").fetchone()[0]
    if n == 0 or inbound == 0 or outbound == 0:
        raise ConfigError(f"{product}/{file_key}: state filter kept {n} rows (inbound {inbound}, outbound {outbound}); "
                          "expected non-zero for all. Check the state fips and zone lookup.")
    dup = con.execute(f"SELECT count(*) FROM (SELECT 1 FROM touching GROUP BY {', '.join(canon)} HAVING count(*) > 1)").fetchone()[0]
    if dup:
        raise ConfigError(f"{product}/{file_key}: {dup} duplicate keys in the source file")

    folder = "flows" if level == "regional" else "state_flows"
    stats: dict[str, Any] = {"rows_touching_wide": n, "inbound": inbound, "outbound": outbound, "years": {}, "scenarios": {}}
    key_select = "".join(f"  {c},\n" for c in canon)
    null = "CAST(NULL AS DOUBLE)"
    for sc, y in slices:
        suffix = f"_{y}_{sc}" if hilo else f"_{y}"
        q = render(
            ctx.paths.sql / "flows_long.sql",
            faf_version=sql_literal(spec["faf_version"]), benchmark_year=spec["benchmark_year"],
            data_version=sql_literal(statuses[y]), scenario=sql_literal(sc), year=y,
            key_select=key_select, tons=f"tons_kt{suffix}", value=f"value_const_musd{suffix}",
            # High/Low files publish tons and value only
            current_value=null if hilo else f"value_current_musd_{y}", tmiles=null if hilo else f"tmiles_m_{y}",
            source_file=sql_literal(fspec["member"]), order_by=", ".join(f"{c} NULLS FIRST" for c in canon),
        )
        dest = ctx.paths.out / product / folder / sc / f"{y}.parquet"
        rows = write_parquet(con, q, dest)
        info = {"rows": rows, "data_version": statuses[y]}
        if sc == spec["scenario"]:
            stats["years"][y] = info
        else:
            stats["scenarios"].setdefault(sc, {"years": {}})["years"][y] = info
    if hilo:
        # the plain (mid-range) columns of the Hi/Lo file must agree with the mid-range files already written
        checks = {}
        for y in year_list:
            mid_file = ctx.paths.out / product / folder / spec["scenario"] / f"{y}.parquet"
            if not mid_file.exists():
                continue
            a = con.execute(f"SELECT sum(tons_kt_{y}), sum(value_const_musd_{y}) FROM touching").fetchone()
            b = con.execute(f"SELECT sum(tons_kt), sum(value_const_musd) FROM read_parquet({sql_literal(mid_file.as_posix())})").fetchone()
            checks[y] = {"hilo_file_mid_tons": a[0], "mid_file_tons": b[0]}
            if any(abs((a[i] or 0) - (b[i] or 0)) > 1e-6 * max(1.0, abs(b[i] or 0)) for i in (0, 1)):
                raise ConfigError(f"{product}/{file_key} {y}: mid-range columns differ from the mid-range file ({a} vs {b})")
        stats["mid_crosscheck"] = checks
    log(f"  {product}/{file_key}: {n} state-touching wide rows, {len(slices)} slices, "
        f"{sum(v['rows'] for v in stats['years'].values()) + sum(v['rows'] for sc in stats['scenarios'].values() for v in sc['years'].values())} long rows")
    stats["year_list"] = year_list
    return stats


def _src(schema: Schema, canonical: str) -> str:
    for src, c in schema.columns.items():
        if c["canonical"] == canonical:
            return src
    raise ConfigError(f"schema {schema.name} has no column mapped to {canonical}")


def build(ctx: Context, products: list[str], log=print) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for p in products:
        if p not in ("faf5", "faf6", "history"):
            continue
        levels = ("state",) if p == "history" else ("regional", "state")
        out[p] = {lvl: build_level(ctx, p, lvl, log) for lvl in levels}
        for lvl in levels:
            if f"{lvl}_hilo" in ctx.sources["products"][p]["files"]:
                hl = build_level(ctx, p, lvl, log, hilo=True)
                out[p][lvl]["scenarios"] = hl["scenarios"]
                out[p][lvl]["mid_crosscheck"] = hl["mid_crosscheck"]
    return out
