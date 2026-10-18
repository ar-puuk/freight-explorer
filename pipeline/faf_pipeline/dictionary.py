"""Column dictionary (dictionary.parquet): label, description, unit, caveat and measured year range for every output column."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from faf_pipeline.config import Context, ConfigError
from faf_pipeline.duck import connect, sql_literal, write_parquet

YEAR_MEASURES = ("tons_kt", "value_const_musd", "value_current_musd", "tmiles_m", "ab_tons_k", "ba_tons_k", "tot_tons_k",
                 "ab_trips_day", "ba_trips_day", "tot_trips_day")


def output_tables(ctx: Context) -> list[tuple[str, str, list[Path]]]:
    """(dataset, table, files) for every Parquet output the dictionary must cover."""
    out = ctx.paths.out
    tables: list[tuple[str, str, list[Path]]] = []
    for ds in ("faf5", "faf6"):
        for folder, table in (("flows", "faf_flows"), ("state_flows", "faf_state_flows")):
            files = sorted((out / ds / folder).glob("*/*.parquet"))
            if files:
                tables.append((ds, table, files))
    for sub, table in (("link_attrs.parquet", "network_links"),):
        if (out / "network" / sub).exists():
            tables.append(("network", table, [out / "network" / sub]))
    lf = sorted((out / "network" / "link_flows").glob("*.parquet"))
    if lf:
        tables.append(("network", "network_link_flows", lf))
    for f in sorted((out / "meta").glob("dim_*.parquet")):
        tables.append(("meta", f.stem, [f]))
    return tables


def load_entries(ctx: Context) -> dict[str, dict[str, Any]]:
    return yaml.safe_load((ctx.paths.schemas / "dictionary.yml").read_text(encoding="utf-8"))["columns"]


def missing_entries(ctx: Context) -> list[str]:
    """Output columns that have no dictionary entry (used by build and validate)."""
    entries = load_entries(ctx)
    con = connect()
    missing = []
    for ds, table, files in output_tables(ctx):
        for (col,) in con.execute(f"SELECT column_name FROM (DESCRIBE SELECT * FROM read_parquet({sql_literal(files[0].as_posix())}))").fetchall():
            if f"{table}.{col}" not in entries and col not in entries:
                missing.append(f"{ds}.{table}.{col}")
    return missing


def build(ctx: Context, log=print) -> int:
    entries = load_entries(ctx)
    missing = missing_entries(ctx)
    if missing:
        raise ConfigError("columns without a dictionary entry (add to schemas/dictionary.yml): " + ", ".join(missing))
    con = connect()
    con.execute("CREATE OR REPLACE TABLE d (dataset VARCHAR, table_name VARCHAR, ordinal INTEGER, column_name VARCHAR, label VARCHAR, "
                "description VARCHAR, unit VARCHAR, first_year INTEGER, last_year INTEGER, caveat VARCHAR)")
    rows = []
    for ds, table, files in output_tables(ctx):
        glob = sql_literal((files[0].parent.as_posix() + "/*.parquet") if len(files) > 1 else files[0].as_posix())
        has_year = "year" in {r[0] for r in con.execute(f"SELECT column_name FROM (DESCRIBE SELECT * FROM read_parquet({glob}))").fetchall()}
        cols = con.execute(f"SELECT column_name FROM (DESCRIBE SELECT * FROM read_parquet({glob}))").fetchall()
        for i, (col,) in enumerate(cols, 1):
            e = entries.get(f"{table}.{col}") or entries[col]
            fy = ly = None
            if has_year and col in YEAR_MEASURES:
                fy, ly = con.execute(f"SELECT min(year), max(year) FROM read_parquet({glob}) WHERE {col} IS NOT NULL").fetchone()
            rows.append((ds, table, i, col, e.get("label"), e.get("description"), e.get("unit"), fy, ly, e.get("caveat")))
    con.executemany("INSERT INTO d VALUES (?,?,?,?,?,?,?,?,?,?)", rows)
    n = write_parquet(con, "SELECT dataset, table_name, ordinal, column_name, label, description, unit, first_year, last_year, caveat "
                           "FROM d ORDER BY dataset, table_name, ordinal", ctx.paths.out / "meta" / "dictionary.parquet")
    log(f"  dictionary: {n} rows")
    return n
