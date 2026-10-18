"""Zone derivation from a (fixture) metadata workbook. Needs DuckDB's excel extension (installed on first use)."""

from __future__ import annotations

import pytest

from faf_pipeline import dims
from faf_pipeline.config import ConfigError
from faf_pipeline.duck import connect, sql_literal


@pytest.fixture
def workbook(fake_ctx):
    try:
        con = connect(excel=True)
    except Exception as e:  # noqa: BLE001  (extension download unavailable offline)
        pytest.skip(f"excel extension unavailable: {e}")
    path = fake_ctx.paths.raw / "faf5" / "meta.xlsx"
    con.execute("CREATE TABLE z AS SELECT * FROM (VALUES "
                "('011', 'Birmingham AL', 'Birmingham-Hoover, AL CFS Area'), "
                "('019', 'Rest of AL', 'Remainder of Alabama'), "
                "('991', 'Testville TL', 'Testville, TL CFS Area'), "
                "('999', 'Rest of TL', 'Remainder of Testland'), "
                "('200', 'Alaska', 'Alaska')) t(\"Numeric Label\", \"Short Description\", \"Long Description\")")
    con.execute(f"COPY z TO {sql_literal(path.as_posix())} (FORMAT xlsx, HEADER true, SHEET 'FAF Zone (Domestic)')")
    return path


def test_state_zones_derived_from_prefix_and_types_classified(fake_ctx, workbook, monkeypatch):
    monkeypatch.setattr(dims, "metadata_path", lambda ctx, product: workbook.as_posix())
    zs = {z.zone_id: z for z in dims.zones(fake_ctx, "faf5")}
    assert [z for z in zs if zs[z].is_state_zone] == ["991", "999"]
    assert zs["991"].type == "metro" and zs["999"].type == "remainder" and zs["200"].type == "whole_state"
    assert dims.state_zone_ids(fake_ctx, "faf5") == ["991", "999"]


def test_leading_zeros_survive(fake_ctx, workbook, monkeypatch):
    monkeypatch.setattr(dims, "metadata_path", lambda ctx, product: workbook.as_posix())
    assert "011" in {z.zone_id for z in dims.zones(fake_ctx, "faf5")}


def test_state_without_zones_fails_clearly(fake_ctx, workbook, monkeypatch):
    monkeypatch.setattr(dims, "metadata_path", lambda ctx, product: workbook.as_posix())
    from dataclasses import replace
    other = replace(fake_ctx, state=replace(fake_ctx.state, fips="77"))
    with pytest.raises(ConfigError, match="no zone ids start with state fips 77"):
        dims.state_zone_ids(other, "faf5")
