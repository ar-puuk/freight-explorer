from __future__ import annotations

import pytest
import yaml

from faf_pipeline.config import ConfigError, State, load_context
from faf_pipeline.schema import SchemaError, check_header, load_schema, scaffold_map
from tests.conftest import REGIONAL_HEADER, TEST_STATE


def test_known_header_passes_and_reports_years(fake_ctx):
    schema = load_schema(fake_ctx, "faf5_regional")
    chk = check_header(schema, REGIONAL_HEADER.split(","))
    assert chk.year_list == [2017, 2024, 2030]
    assert chk.years[2024]["current_value"] == "current_value_2024"
    assert "current_value" not in chk.years[2017]


def test_new_year_columns_are_accepted_without_a_schema_edit(fake_ctx):
    schema = load_schema(fake_ctx, "faf5_regional")
    header = REGIONAL_HEADER.split(",") + ["tons_2025", "value_2025"]
    assert 2025 in check_header(schema, header).years


def test_unmapped_column_fails_with_suggestion(fake_ctx):
    schema = load_schema(fake_ctx, "faf5_regional")
    header = [c.replace("sctg2", "sctg_2") for c in REGIONAL_HEADER.split(",")]
    with pytest.raises(SchemaError) as e:
        check_header(schema, header)
    msg = str(e.value)
    assert "unmapped column 'sctg_2'" in msg and "did you mean sctg2" in msg and "missing column 'sctg2'" in msg


def test_missing_required_measure_fails(fake_ctx):
    schema = load_schema(fake_ctx, "faf5_regional")
    header = [c for c in REGIONAL_HEADER.split(",") if not c.startswith("value_")]
    with pytest.raises(SchemaError, match="value_YYYY"):
        check_header(schema, header)


def test_every_shipped_flow_schema_has_unique_canonical_names(fake_ctx):
    for name in ("faf5_regional", "faf5_state", "faf6_regional", "faf6_state"):
        s = load_schema(fake_ctx, name)
        canon = [c["canonical"] for c in s.columns.values()]
        assert len(canon) == len(set(canon)), name


def test_scaffold_marks_differences(fake_ctx):
    header = [c for c in REGIONAL_HEADER.split(",") if c != "dist_band"] + ["new_col"]
    dest = scaffold_map(fake_ctx, "faf5_regional", header, "scaffolded")
    try:
        d = yaml.safe_load(dest.read_text(encoding="utf-8"))
        assert d["columns"]["dist_band"]["optional"] is True
        assert "TODO" in d["ignore"]["new_col"]
    finally:
        dest.unlink()


def test_state_config_validation():
    with pytest.raises(ConfigError, match="fips"):
        State.from_dict("x", {**TEST_STATE, "fips": "9"})
    with pytest.raises(ConfigError, match="missing"):
        State.from_dict("x", {"name": "Only"})


def test_unknown_state_lists_available(fake_ctx):
    with pytest.raises(ConfigError, match="testland"):
        load_context("nowhere", fake_ctx.paths.root)
