from __future__ import annotations

import duckdb
import pytest

from faf_pipeline import flows
from faf_pipeline.config import ConfigError
from tests.conftest import GOOD_ROWS, REGIONAL_HEADER, regional_csv, write_regional


def read(ctx, year):
    f = ctx.paths.out / "faf5" / "flows" / "mid" / f"{year}.parquet"
    return duckdb.sql(f"SELECT * FROM read_parquet('{f.as_posix()}') ORDER BY ALL").fetchall(), duckdb.sql(
        f"DESCRIBE SELECT * FROM read_parquet('{f.as_posix()}')").fetchall()


def test_filters_to_state_touching_rows_and_unpivots(fake_ctx):
    write_regional(fake_ctx, regional_csv(GOOD_ROWS))
    stats = flows.build_level(fake_ctx, "faf5", "regional", log=lambda *_: None)
    assert stats["rows_touching_wide"] == 5            # the 011->012 row never touches the state
    assert sorted(stats["year_list"]) == [2017, 2024, 2030]
    rows, cols = read(fake_ctx, 2017)
    names = [c[0] for c in cols]
    assert len(rows) == 5
    # 011/012 style ids keep their leading zero
    zones = {r[names.index("dms_orig")] for r in rows} | {r[names.index("dms_dest")] for r in rows}
    assert {"011", "012", "991", "999"} <= zones


def test_zero_rows_dropped_and_missing_measures_are_null(fake_ctx):
    write_regional(fake_ctx, regional_csv(GOOD_ROWS))
    flows.build_level(fake_ctx, "faf5", "regional", log=lambda *_: None)
    rows24, cols = read(fake_ctx, 2024)
    names = [c[0] for c in cols]
    assert len(rows24) == 4                              # inbound row is all-zero in 2024 -> dropped
    cur = names.index("value_current_musd")
    assert all(r[cur] is not None for r in rows24)       # current_value_2024 exists
    rows17, _ = read(fake_ctx, 2017)
    assert all(r[cur] is None for r in rows17)           # no current_value_2017 column: NULL, never 0


def test_data_version_comes_from_config_not_year_guess(fake_ctx):
    write_regional(fake_ctx, regional_csv(GOOD_ROWS))
    stats = flows.build_level(fake_ctx, "faf5", "regional", log=lambda *_: None)
    got = {y: v["data_version"] for y, v in stats["years"].items()}
    assert got == {2017: "base", 2024: "preliminary", 2030: "forecast"}


def test_unclassified_year_fails(fake_ctx):
    header = REGIONAL_HEADER.replace("tons_2030", "tons_2019").replace("value_2030", "value_2019").replace("tmiles_2030", "tmiles_2019")
    rows = [r for r in GOOD_ROWS]
    write_regional(fake_ctx, regional_csv(rows, header))
    # 2019 is neither base/final/preliminary nor >= forecast_from
    with pytest.raises(ConfigError, match="not classified"):
        flows.build_level(fake_ctx, "faf5", "regional", log=lambda *_: None)


def test_requires_inbound_and_outbound(fake_ctx):
    only_inside = [GOOD_ROWS[0]]
    write_regional(fake_ctx, regional_csv(only_inside))
    with pytest.raises(ConfigError, match="state filter kept"):
        flows.build_level(fake_ctx, "faf5", "regional", log=lambda *_: None)


def test_duplicate_keys_fail(fake_ctx):
    write_regional(fake_ctx, regional_csv(GOOD_ROWS + [GOOD_ROWS[0]]))
    with pytest.raises(ConfigError, match="duplicate keys"):
        flows.build_level(fake_ctx, "faf5", "regional", log=lambda *_: None)


def test_output_is_byte_identical_on_rerun(fake_ctx):
    write_regional(fake_ctx, regional_csv(GOOD_ROWS))
    flows.build_level(fake_ctx, "faf5", "regional", log=lambda *_: None)
    d = fake_ctx.paths.out / "faf5" / "flows" / "mid"
    first = {p.name: p.read_bytes() for p in d.glob("*.parquet")}
    flows.build_level(fake_ctx, "faf5", "regional", log=lambda *_: None)
    second = {p.name: p.read_bytes() for p in d.glob("*.parquet")}
    assert first == second and first


def test_schema_drift_in_a_source_file_fails_the_build(fake_ctx):
    write_regional(fake_ctx, regional_csv(GOOD_ROWS, REGIONAL_HEADER + ",surprise_col"))
    from faf_pipeline.schema import SchemaError
    with pytest.raises(SchemaError, match="surprise_col"):
        flows.build_level(fake_ctx, "faf5", "regional", log=lambda *_: None)
