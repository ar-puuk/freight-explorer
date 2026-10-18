"""Schema-drift guard. A column map (schemas/*.yml) says what every source column means; anything else fails the build.

Wide year columns are allowed by pattern (`tons_2024`, `value_2030`, ...), so new years arrive without a schema edit,
but they are reported so the changelog lists every newly appeared year.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from faf_pipeline.config import Context


class SchemaError(Exception):
    pass


@dataclass
class Schema:
    name: str
    columns: dict[str, dict[str, Any]]         # source column -> {canonical, type, ...}
    ignore: dict[str, str]                      # source column -> reason
    year_columns: dict[str, str]                # source prefix -> canonical measure column
    required_measures: list[str]
    raw: dict[str, Any]

    def year_regex(self) -> re.Pattern[str]:
        alt = "|".join(sorted((re.escape(p) for p in self.year_columns), key=len, reverse=True))
        return re.compile(rf"^({alt})_(\d{{4}})$")


@dataclass
class HeaderCheck:
    years: dict[int, dict[str, str]] = field(default_factory=dict)   # year -> {source prefix: source column}

    @property
    def year_list(self) -> list[int]:
        return sorted(self.years)


def load_schema(ctx: Context, name: str) -> Schema:
    path = ctx.paths.schemas / f"{name}.yml"
    if not path.exists():
        raise SchemaError(f"no column map {path.name}")
    d = yaml.safe_load(path.read_text(encoding="utf-8"))
    return Schema(name=name, columns=d.get("columns") or {}, ignore=d.get("ignore") or {},
                  year_columns=d.get("year_columns") or {}, required_measures=d.get("required_measures") or [], raw=d)


def check_header(schema: Schema, header: list[str]) -> HeaderCheck:
    rx = schema.year_regex() if schema.year_columns else None
    known = set(schema.columns) | set(schema.ignore)
    problems: list[str] = []
    out = HeaderCheck()
    for col in header:
        if col in known:
            continue
        m = rx.match(col) if rx else None
        if m:
            out.years.setdefault(int(m.group(2)), {})[m.group(1)] = col
            continue
        near = difflib.get_close_matches(col, list(known), n=3, cutoff=0.6)
        hint = f" (did you mean {', '.join(near)}?)" if near else ""
        problems.append(f"unmapped column {col!r}{hint}")
    for col, spec in schema.columns.items():
        if col not in header and not spec.get("optional"):
            near = difflib.get_close_matches(col, header, n=3, cutoff=0.6)
            hint = f" (found {', '.join(near)}?)" if near else ""
            problems.append(f"missing column {col!r}{hint}")
    for prefix in schema.required_measures:
        if not any(prefix in cols for cols in out.years.values()):
            problems.append(f"no `{prefix}_YYYY` columns found")
    if problems:
        raise SchemaError(f"schema {schema.name}: " + "; ".join(problems) +
                          ". Update pipeline/faf_pipeline/schemas/%s.yml (or run build --scaffold-map)." % schema.name)
    return out


def scaffold_map(ctx: Context, from_schema: str, header: list[str], to_name: str) -> Path:
    """Copy an existing map for a new release, marking differences for a human to resolve."""
    old = load_schema(ctx, from_schema)
    rx = old.year_regex() if old.year_columns else None
    new = dict(old.raw)
    cols = dict(old.columns)
    for c in list(cols):
        if c not in header:
            cols[c] = {**cols[c], "optional": True, "note": f"TODO: not in the new release's header ({c})"}
    known = set(old.columns) | set(old.ignore)
    ignore = dict(old.ignore)
    for c in header:
        if c not in known and not (rx and rx.match(c)):
            ignore[c] = "TODO: new column; map it under `columns` or give a reason to ignore it"
    new["columns"], new["ignore"] = cols, ignore
    dest = ctx.paths.schemas / f"{to_name}.yml"
    dest.write_text(yaml.safe_dump(new, sort_keys=False), encoding="utf-8")
    return dest
