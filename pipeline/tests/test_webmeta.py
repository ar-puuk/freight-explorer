"""The year-totals file behind the timeline sparkline: unfiltered state totals per published year and scenario, NULL = not published."""

from __future__ import annotations

from pathlib import Path

from faf_pipeline.duck import connect, sql_literal
from faf_pipeline.webmeta import year_totals


def _write(con, path: Path, rows: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    con.execute(
        f"COPY (SELECT * FROM (VALUES {rows}) t(tons_kt, value_const_musd, value_current_musd, tmiles_m)) TO {sql_literal(path.as_posix())} (FORMAT PARQUET)")


def test_year_totals_by_scenario_and_year(tmp_path: Path) -> None:
    con = connect()
    flows = tmp_path / "flows"
    _write(con, flows / "mid" / "2022.parquet", "(10.0, 100.0, 120.0, 5.0), (2.5, 20.0, 24.0, 1.0)")
    _write(con, flows / "mid" / "2030.parquet", "(15.0, 150.0, NULL, 8.0)")
    _write(con, flows / "high" / "2030.parquet", "(18.0, 170.0, NULL, NULL)")
    out = year_totals(con, flows, "9.9")
    assert out["faf_version"] == "9.9"
    assert out["columns"] == ["tons_kt", "value_const_musd", "value_current_musd", "tmiles_m"]
    assert out["totals"]["mid"]["2022"] == [12.5, 120.0, 144.0, 6.0]
    assert out["totals"]["mid"]["2030"] == [15.0, 150.0, None, 8.0]
    assert set(out["totals"]) == {"mid", "high"}


def test_not_published_stays_null_and_is_never_zero(tmp_path: Path) -> None:
    con = connect()
    flows = tmp_path / "flows"
    _write(con, flows / "high" / "2035.parquet", "(18.0, 170.0, NULL, NULL)")
    row = year_totals(con, flows, "9.9")["totals"]["high"]["2035"]
    assert row[2] is None and row[3] is None
    assert row[0] == 18.0
