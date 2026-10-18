"""FAF origin-destination flows: guard the schema, filter to the state, unpivot wide years, write Parquet per year."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from faf_pipeline.config import Context, ConfigError
from faf_pipeline.dims import state_zone_ids
from faf_pipeline.duck import connect, render, sql_literal, write_parquet
from faf_pipeline.fetch import extracted
from faf_pipeline.schema import Schema, check_header, load_schema

MEASURES = ("tons_kt", "value_const_musd", "value_current_musd", "tmiles_m")


def classify_year(spec: dict[str, Any], year: int, product: str) -> str:
    dv = spec["data_version"]
    for label in ("base", "final", "preliminary"):
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
        "code2": f"lpad({c}, 2, '0')",
    }[typ]


def _read_header(con, csv: Path) -> list[str]:
    rel = con.execute(f"SELECT * FROM read_csv({sql_literal(csv.as_posix())}, all_varchar = true, header = true) LIMIT 0")
    return [d[0] for d in rel.description]


def build_level(ctx: Context, product: str, level: str, log=print) -> dict[str, Any]:
    """Build one level ('regional' or 'state') of one product. Returns stats for the changelog/validation."""
    spec = ctx.sources["products"][product]
    fspec = spec["files"][level]
    schema = load_schema(ctx, fspec["schema"])
    csv = extracted(ctx, product, level)
    con = connect()
    header = _read_header(con, csv)
    years = check_header(schema, header).years
    year_list = sorted(years)
    statuses = {y: classify_year(spec, y, product) for y in year_list}

    keys = [(src, c["canonical"], c["type"]) for src, c in schema.columns.items()]
    canon = [k[1] for k in keys]
    sel = [f"  {_typed(src, typ)} AS {name}" for src, name, typ in keys]
    for y in year_list:
        for prefix, measure in schema.year_columns.items():
            col = years[y].get(prefix)
            sel.append(f"  TRY_CAST(\"{col}\" AS DOUBLE) AS {measure}_{y}" if col else f"  CAST(NULL AS DOUBLE) AS {measure}_{y}")

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
        raise ConfigError(f"{product}/{level}: state filter kept {n} rows (inbound {inbound}, outbound {outbound}); "
                          "expected non-zero for all. Check the state fips and zone lookup.")
    dup = con.execute(f"SELECT count(*) FROM (SELECT 1 FROM touching GROUP BY {', '.join(canon)} HAVING count(*) > 1)").fetchone()[0]
    if dup:
        raise ConfigError(f"{product}/{level}: {dup} duplicate keys in the source file")

    folder = "flows" if level == "regional" else "state_flows"
    stats: dict[str, Any] = {"rows_touching_wide": n, "inbound": inbound, "outbound": outbound, "years": {}}
    key_select = "".join(f"  {c},\n" for c in canon)
    for y in year_list:
        q = render(
            ctx.paths.sql / "flows_long.sql",
            faf_version=sql_literal(spec["faf_version"]), benchmark_year=spec["benchmark_year"],
            data_version=sql_literal(statuses[y]), scenario=sql_literal(spec["scenario"]), year=y,
            key_select=key_select, tons=f"tons_kt_{y}", value=f"value_const_musd_{y}",
            current_value=f"value_current_musd_{y}", tmiles=f"tmiles_m_{y}",
            source_file=sql_literal(fspec["member"]), order_by=", ".join(f"{c} NULLS FIRST" for c in canon),
        )
        dest = ctx.paths.out / product / folder / spec["scenario"] / f"{y}.parquet"
        rows = write_parquet(con, q, dest)
        tot = con.execute(f"SELECT sum(tons_kt_{y}), sum(value_const_musd_{y}) FROM touching").fetchone()
        stats["years"][y] = {"rows": rows, "data_version": statuses[y], "tons_kt_all_rows": tot[0], "value_const_musd_all_rows": tot[1]}
    log(f"  {product}/{level}: {n} state-touching wide rows, years {year_list[0]}..{year_list[-1]} ({len(year_list)}), "
        f"{sum(v['rows'] for v in stats['years'].values())} long rows")
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
        if p not in ("faf5", "faf6"):
            continue
        out[p] = {lvl: build_level(ctx, p, lvl, log) for lvl in ("regional", "state")}
    return out
