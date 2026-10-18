"""History series and experimental county product, on tiny fixtures (a fictional state, fips 99, with one fictional neighbor, fips 98)."""

from __future__ import annotations

import json
import zipfile

import duckdb
import pytest

from faf_pipeline import county, flows
from faf_pipeline.config import ConfigError
from faf_pipeline.duck import connect, sql_literal

HISTORY_HEADER = "fr_orig,dms_origst,dms_destst,fr_dest,fr_inmode,dms_mode,fr_outmode,sctg2,trade_type,tons_1997,tons_2002,value_1997,value_2002,current_value_1997,current_value_2002,tmiles_1997,tmiles_2002"
HISTORY_ROWS = [
    ",99,99,,,1,,01,1,10,11,100,110,60,65,5,6",      # within
    ",98,99,,,1,,01,1,3,0,30,0,18,0,1,0",            # inbound, zero in 2002 -> dropped there
    ",99,98,,,2,,02,1,5,5,50,50,30,31,2,2",          # outbound
    ",97,98,,,1,,03,1,9,9,90,90,50,51,3,3",          # does not touch the state
]


def test_history_is_written_as_historical_state_level(fake_ctx):
    (fake_ctx.paths.raw / "history").mkdir(parents=True)
    (fake_ctx.paths.raw / "history" / "HISTORY.csv").write_text(HISTORY_HEADER + "\n" + "\n".join(HISTORY_ROWS) + "\n", encoding="utf-8")
    stats = flows.build_level(fake_ctx, "history", "state", log=lambda *_: None)
    assert sorted(stats["years"]) == [1997, 2002]
    assert {v["data_version"] for v in stats["years"].values()} == {"historical"}
    d = fake_ctx.paths.out / "history" / "state_flows" / "mid"
    f97 = duckdb.sql(f"SELECT count(*), sum(tons_kt), any_value(benchmark_year) FROM read_parquet('{(d / '1997.parquet').as_posix()}')").fetchone()
    f02 = duckdb.sql(f"SELECT count(*) FROM read_parquet('{(d / '2002.parquet').as_posix()}')").fetchone()[0]
    assert f97 == (3, 18.0, 2017)                    # the row that does not touch the state is gone
    assert f02 == 2                                  # the all-zero 2002 row is dropped, never kept as 0
    cols = [c[0] for c in duckdb.sql(f"DESCRIBE SELECT * FROM read_parquet('{(d / '1997.parquet').as_posix()}')").fetchall()]
    assert "dms_orig_st" in cols and "dist_band" not in cols


# ---------------------------------------------------------------------------------------------------------------------- county
C2C_HEAD = "trade_type,fr_orig,fr_inmode,fr_dest,fr_outmode,dms_orig,dms_orig_cnty,dms_dest,dms_dest_cnty,sctgG5,dms_mode,tons_2022"
C2F_HEAD = "trade_type,fr_orig,fr_inmode,fr_dest,fr_outmode,dms_orig,dms_orig_cnty,dms_dest,sctgG5,dms_mode,tons_2022"
F2C_HEAD = "trade_type,fr_orig,fr_inmode,fr_dest,fr_outmode,dms_orig,dms_dest,dms_dest_cnty,sctgG5,dms_mode,tons_2022"
C2C = [
    "1,,,,,991,99001,991,99002,sctg0109,11,10",          # inside the state
    "1,,,,,991,99001,981,98001,sctg0109,11,5",           # state to the neighbor
    "1,,,,,981,98001,981,98002,sctg0109,11,7",           # neighbor to neighbor: does not touch the state
    "2,802,1,,,981,98001,991,99002,sctg0109,11,3",       # an import arriving in the state
    "1,,,,,991,99002,991,99001,sctg0109,11,0",           # zero: dropped
]
C2F = ["1,,,,,991,99001,555,sctg0109,11,4", "1,,,,,981,98001,555,sctg0109,11,9"]   # second row starts in the neighbor
F2C = ["1,,,,,555,991,99002,sctg0109,11,6", "1,,,,,555,981,98002,sctg0109,11,8"]   # second row ends in the neighbor


def _factor_csv(col: str, zone_county: list[tuple[str, str, float]]) -> str:
    rows = [f"{z},{c},sctg0109,{f}" for z, c, f in zone_county]
    return f"dms_{col},dms_{col}_cnty,sctgG5,f_{col}\n" + "\n".join(rows) + "\n"


@pytest.fixture
def county_ctx(fake_ctx):
    try:
        con = connect(spatial=True)
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"spatial extension unavailable: {e}")
    raw = fake_ctx.paths.raw
    (raw / "county").mkdir(parents=True)
    (raw / "census").mkdir(parents=True)
    with zipfile.ZipFile(raw / "county" / "99 - Testland.zip", "w") as z:
        z.writestr("1.County-to-County.csv", C2C_HEAD + "\n" + "\n".join(C2C) + "\n")
        z.writestr("2.County-to-FAF.csv", C2F_HEAD + "\n" + "\n".join(C2F) + "\n")
        z.writestr("2.FAF-to-County.csv", F2C_HEAD + "\n" + "\n".join(F2C) + "\n")
    with zipfile.ZipFile(raw / "county" / "factors.zip", "w") as z:
        for stem in ("truck", "rail", "water", "pipeline"):
            z.writestr(f"{stem}_origin_factors.csv", _factor_csv("orig", [("991", "99001", 0.25), ("991", "99002", 0.75), ("981", "98001", 1.0)]))
            z.writestr(f"{stem}_destination_factors.csv", _factor_csv("dest", [("991", "99001", 0.5), ("991", "99002", 0.5), ("981", "98001", 0.4), ("981", "98002", 0.6)]))
    # boundaries: four unit-square counties
    shp_dir = fake_ctx.paths.root / "shp"
    shp_dir.mkdir()
    squares = ", ".join(f"('{g}', '{n}', '{s}', '{st}', ST_GeomFromText('POLYGON(({x} 0, {x + 1} 0, {x + 1} 1, {x} 1, {x} 0))'))"
                        for g, n, s, st, x in (("99001", "Alpha County", "TL", "99", 0), ("99002", "Beta County", "TL", "99", 1),
                                               ("98001", "Gamma County", "NB", "98", 2), ("98002", "Delta County", "NB", "98", 3)))
    con.execute(f"CREATE TABLE sq AS SELECT * FROM (VALUES {squares}) t(GEOID, NAMELSAD, STUSPS, STATEFP, geom)")
    con.execute(f"COPY sq TO {sql_literal((shp_dir / 'cb.shp').as_posix())} (FORMAT GDAL, DRIVER 'ESRI Shapefile')")
    with zipfile.ZipFile(raw / "census" / "cb.zip", "w") as z:
        for f in shp_dir.glob("cb.*"):
            z.write(f, f.name)
    (raw / "census" / "centers.txt").write_text(
        "STATEFP,COUNTYFP,COUNAME,STNAME,POPULATION,LATITUDE,LONGITUDE\n99,001,Alpha,T,100,+0.5,+0.5\n99,002,Beta,T,300,+0.5,+1.5\n"
        "98,001,Gamma,N,50,+0.5,+2.5\n98,002,Delta,N,50,+0.5,+3.5\n", encoding="utf-8")
    meta = fake_ctx.paths.out / "meta"
    meta.mkdir(parents=True)
    con.execute("CREATE TABLE dz AS SELECT '9.9' AS faf_version, '555' AS zone_id, 'Elsewhere' AS short_name, '55' AS state_fips, 'metro' AS type, "
                "-90.0 AS anchor_lon, 35.0 AS anchor_lat")
    con.execute(f"COPY dz TO {sql_literal((meta / 'dim_zone.parquet').as_posix())} (FORMAT parquet)")
    return fake_ctx


def test_county_keeps_only_state_touching_rows_without_double_counting(county_ctx):
    stats = county.build(county_ctx, log=lambda *_: None)
    assert stats["rows_by_table"] == {"c2c": 3, "c2f": 1, "f2c": 1}
    assert stats["adjacent_states"] == ["98"]                     # derived from the data, not typed
    f = (county_ctx.paths.out / "county" / "flows" / "mid" / "2022.parquet").as_posix()
    row = duckdb.sql(f"SELECT count(*), sum(tons_kt), count(value_const_musd), count(tmiles_m), min(data_version), min(faf_version) FROM read_parquet('{f}')").fetchone()
    assert row == (5, 28.0, 0, 0, "experimental", "county-fx")    # 10+5+3+4+6 tons; the neighbor-only rows (7, 9, 8) and the zero row are out; tons only
    kinds = dict(duckdb.sql(f"SELECT table_kind, count(*) FROM read_parquet('{f}') GROUP BY 1").fetchall())
    assert kinds == {"c2c": 3, "c2f": 1, "f2c": 1}


def test_county_ids_are_padded_strings_and_zone_endpoints_are_three_characters(county_ctx):
    county.build(county_ctx, log=lambda *_: None)
    f = (county_ctx.paths.out / "county" / "flows" / "mid" / "2022.parquet").as_posix()
    rows = duckdb.sql(f"SELECT table_kind, dms_orig, dms_dest, orig_zone, dest_zone FROM read_parquet('{f}') ORDER BY ALL").fetchall()
    assert ("c2f", "99001", "555", "991", "555") in rows
    assert ("f2c", "555", "99002", "555", "991") in rows
    assert all(len(o) in (3, 5) and len(d) in (3, 5) for _, o, d, _, _ in rows)


def test_county_geography_and_locations(county_ctx):
    county.build(county_ctx, log=lambda *_: None)
    gj = json.loads((county_ctx.paths.out / "geo" / "county_zones.geojson").read_text(encoding="utf-8"))
    props = {f["properties"]["zone_id"]: f["properties"] for f in gj["features"]}
    assert sorted(props) == ["98001", "98002", "99001", "99002"]
    assert props["99001"]["is_state_zone"] and not props["98001"]["is_state_zone"]
    assert props["99001"]["name"] == "Alpha County, TL"
    locs = {x["id"]: x for x in json.loads((county_ctx.paths.out / "geo" / "county_locations.json").read_text(encoding="utf-8"))}
    assert locs["555"]["name"] == "Elsewhere" and locs["555"]["type"] == "metro"        # the outside zone used by the c2f/f2c rows
    assert abs(locs["99001"]["lon"] - 0.5) < 1e-6                                       # Census center of population
    state = {k for k, v in locs.items() if v["type"] == "county" and v["is_state_zone"]}
    assert state == {"99001", "99002"}


def test_county_factors_filtered_to_the_multistate_area_and_sum_to_one(county_ctx):
    stats = county.build(county_ctx, log=lambda *_: None)
    f = (county_ctx.paths.out / "county" / "factors.parquet").as_posix()
    n, bad = duckdb.sql(f"SELECT count(*), (SELECT count(*) FROM (SELECT 1 FROM read_parquet('{f}') GROUP BY mode_group, direction, faf_zone, commodity_group HAVING abs(sum(factor) - 1) > 1e-6)) FROM read_parquet('{f}')").fetchone()
    assert n == stats["factors_rows"] == 4 * (3 + 4)           # 4 mode groups x (3 origin + 4 destination factor rows)
    assert bad == 0


def test_county_schema_drift_fails(county_ctx):
    raw = county_ctx.paths.raw / "county" / "99 - Testland.zip"
    with zipfile.ZipFile(raw, "w") as z:
        z.writestr("1.County-to-County.csv", C2C_HEAD + ",surprise\n" + "\n".join(r + ",x" for r in C2C) + "\n")
        z.writestr("2.County-to-FAF.csv", C2F_HEAD + "\n" + "\n".join(C2F) + "\n")
        z.writestr("2.FAF-to-County.csv", F2C_HEAD + "\n" + "\n".join(F2C) + "\n")
    from faf_pipeline.schema import SchemaError
    with pytest.raises(SchemaError, match="surprise"):
        county.build(county_ctx, log=lambda *_: None)


def test_county_fails_when_a_state_has_no_adjacent_counties(county_ctx):
    raw = county_ctx.paths.raw / "county" / "99 - Testland.zip"
    only_state = [r for r in C2C if r.startswith("1,,,,,991,99001,991,99002")]
    with zipfile.ZipFile(raw, "w") as z:
        z.writestr("1.County-to-County.csv", C2C_HEAD + "\n" + "\n".join(only_state) + "\n")
        z.writestr("2.County-to-FAF.csv", C2F_HEAD + "\n" + "\n".join(C2F) + "\n")
        z.writestr("2.FAF-to-County.csv", F2C_HEAD + "\n" + "\n".join(F2C) + "\n")
    with pytest.raises(ConfigError):
        county.build(county_ctx, log=lambda *_: None)
