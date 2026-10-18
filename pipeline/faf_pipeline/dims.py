"""Dimension tables from the FAF metadata workbooks, and derivation of the state's zones from the zone lookup."""

from __future__ import annotations

from dataclasses import dataclass

from faf_pipeline.config import Context, ConfigError
from faf_pipeline.duck import connect, sql_literal, write_parquet
from faf_pipeline.fetch import extracted

# Sheet names and expected columns in FAF5_metadata.xlsx / FAF6_Metadata.xlsx (verified 2026-10-18).
SHEETS = {
    "zone": ("FAF Zone (Domestic)", ["Numeric Label", "Short Description", "Long Description"]),
    "foreign": ("FAF Zone (Foreign)", ["Numeric Label", "Description"]),
    "commodity": ("Commodity (SCTG2)", ["Numeric Label", "Description"]),
    "mode": ("Mode", ["Numeric Label", "Description"]),
    "trade_type": ("Trade Type", ["Numeric Label", "Description"]),
    "dist_band": ("Distance Band", ["Numeric Label", "Description"]),
}


@dataclass(frozen=True)
class Zone:
    zone_id: str
    short_name: str
    long_name: str
    state_fips: str
    type: str            # metro | remainder | whole_state
    is_state_zone: bool


def _sheet(con, xlsx: str, key: str) -> list[tuple]:
    sheet, cols = SHEETS[key]
    rel = con.execute(f"SELECT * FROM read_xlsx({sql_literal(xlsx)}, sheet = {sql_literal(sheet)}, all_varchar = true)")
    have = [d[0] for d in rel.description]
    if have[: len(cols)] != cols:
        raise ConfigError(f"metadata sheet {sheet!r}: expected columns {cols}, found {have}")
    return [tuple(r[: len(cols)]) for r in rel.fetchall()]


def metadata_path(ctx: Context, product: str) -> str:
    return extracted(ctx, product, "metadata").as_posix()


def zones(ctx: Context, product: str) -> list[Zone]:
    """All domestic zones for a version, with the state's zones flagged by zone-id prefix = state FIPS."""
    con = connect(excel=True)
    rows = _sheet(con, metadata_path(ctx, product), "zone")
    clean = []
    for zid, short, long_ in rows:
        zid = str(zid).strip().zfill(3)
        clean.append((zid, (short or "").strip(), (long_ or "").strip()))
    per_state: dict[str, int] = {}
    for zid, _, _ in clean:
        per_state[zid[:2]] = per_state.get(zid[:2], 0) + 1
    out = []
    for zid, short, long_ in sorted(clean):
        st = zid[:2]
        if per_state[st] == 1:
            ztype = "whole_state"
        elif long_.lower().startswith("remainder"):
            ztype = "remainder"
        else:
            ztype = "metro"
        out.append(Zone(zid, short, long_, st, ztype, st == ctx.state.fips))
    return out


def state_zone_ids(ctx: Context, product: str) -> list[str]:
    ids = [z.zone_id for z in zones(ctx, product) if z.is_state_zone]
    if not ids:
        raise ConfigError(f"{product}: no zone ids start with state fips {ctx.state.fips}; check config/states/{ctx.state.slug}.yml")
    return ids


def build_dims(ctx: Context, products: list[str], log=print) -> dict[str, int]:
    """Write dim_commodity, dim_mode, dim_trade_type, dim_foreign_region, dim_dist_band (all versions, one row per version+code)."""
    con = connect(excel=True)
    versions = {p: ctx.sources["products"][p]["faf_version"] for p in products}
    tables = {
        "commodity": ("dim_commodity", "sctg2", "label"),
        "mode": ("dim_mode", "mode", "label"),
        "trade_type": ("dim_trade_type", "trade_type", "label"),
        "foreign": ("dim_foreign_region", "region_id", "label"),
        "dist_band": ("dim_dist_band", "dist_band", "label"),
    }
    counts: dict[str, int] = {}
    for key, (name, code_col, label_col) in tables.items():
        rows = []
        for product in products:
            for code, label in _sheet(con, metadata_path(ctx, product), key):
                code = str(code).strip()
                if key == "commodity":
                    code = code.zfill(2)
                if key in ("mode", "trade_type", "dist_band"):
                    code = int(code)
                rows.append((versions[product], code, (label or "").strip()))
        con.execute(f"CREATE OR REPLACE TABLE t ({'faf_version VARCHAR'}, {code_col} {'INTEGER' if isinstance(rows[0][1], int) else 'VARCHAR'}, {label_col} VARCHAR)")
        con.executemany("INSERT INTO t VALUES (?, ?, ?)", rows)
        counts[name] = write_parquet(con, f"SELECT * FROM t ORDER BY faf_version, {code_col}", ctx.paths.out / "meta" / f"{name}.parquet")
        log(f"  {name}: {counts[name]} rows")
    return counts
