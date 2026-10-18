"""DuckDB helpers: connection setup, SQL templates, deterministic Parquet/JSON writers."""

from __future__ import annotations

import json
import string
from pathlib import Path
from typing import Any

import duckdb

ROW_GROUP_SIZE = 100_000


def connect(spatial: bool = False, excel: bool = False) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    con.execute("SET threads TO 1")                    # one writer thread: stable row-group layout
    con.execute("SET preserve_insertion_order = true")
    for ext, wanted in (("spatial", spatial), ("excel", excel)):
        if wanted:
            con.execute(f"INSTALL {ext}")
            con.execute(f"LOAD {ext}")
    if spatial:
        con.execute("SET geometry_always_xy = true")
    return con


def sql_literal(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def render(sql_path: Path, **params: Any) -> str:
    """Load a .sql file and substitute ${name} placeholders (missing names raise)."""
    return string.Template(sql_path.read_text(encoding="utf-8")).substitute(**params)


def write_parquet(con: duckdb.DuckDBPyConnection, query: str, dest: Path) -> int:
    """Write `query` to `dest` as ZSTD Parquet. The query must carry its own total ORDER BY."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    con.execute(f"COPY ({query}) TO {sql_literal(tmp.as_posix())} "
                f"(FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE {ROW_GROUP_SIZE})")
    tmp.replace(dest)
    return con.execute(f"SELECT count(*) FROM read_parquet({sql_literal(dest.as_posix())})").fetchone()[0]


def write_json(obj: Any, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, indent=1, sort_keys=True, ensure_ascii=False) + "\n"
    dest.write_text(text, encoding="utf-8", newline="\n")
