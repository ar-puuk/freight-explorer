"""Shared fixtures: a throwaway repo root with a fictional state, so tests never depend on the real data or state."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from faf_pipeline.config import Context, load_context

TEST_STATE = {
    "name": "Testland", "abbrev": "TL", "fips": "99", "bbox": [-100.0, 30.0, -90.0, 40.0], "center": [-95.0, 35.0],
    "zoom": 6, "site_title": "Testland Freight Explorer", "network_buffer_km": 10, "overrides": {},
}

SOURCES = {
    "products": {
        "faf5": {
            "faf_version": "9.9", "benchmark_year": 2017, "scenario": "mid", "release": "fixture",
            "data_version": {"base": [2017], "final": [2018], "preliminary": [2024], "forecast_from": 2025},
            "files": {
                "regional": {"url": "http://example.invalid/REGIONAL.csv", "member": "REGIONAL.csv", "schema": "faf5_regional"},
                "state": {"url": "http://example.invalid/STATE.csv", "member": "STATE.csv", "schema": "faf5_state"},
            },
        }
    },
    "geo": {"zone_simplify_deg": 0.005, "coord_decimals": 4, "pmtiles_minzoom": 3, "pmtiles_maxzoom": 12},
}

REGIONAL_HEADER = ("fr_orig,dms_orig,dms_dest,fr_dest,fr_inmode,dms_mode,fr_outmode,sctg2,trade_type,dist_band,"
                   "tons_2017,tons_2024,tons_2030,value_2017,value_2024,value_2030,current_value_2024,tmiles_2017,tmiles_2024,tmiles_2030")


def regional_csv(rows: list[str], header: str = REGIONAL_HEADER) -> str:
    return header + "\n" + "\n".join(rows) + "\n"


# in-state zones are 991 and 999; 011/012 are elsewhere
GOOD_ROWS = [
    ",991,991,,,1,,01,1,1,10,11,12,100,110,120,115,5,6,7",      # within state
    ",011,991,,,1,,01,1,2,3,0,4,30,0,40,0,1,0,2",               # inbound; 2024 tons/value zero, kept because current_value... zero too -> dropped for 2024
    ",991,012,,,2,,02,1,3,5,5,5,50,50,50,55,2,2,2",             # outbound
    ",011,012,,,1,,03,1,4,9,9,9,90,90,90,99,3,3,3",             # does not touch the state: must be dropped
    "802,999,999,,5,1,,04,2,5,7,8,9,70,80,90,85,4,5,6",          # import entering the state
    ",999,011,801,,1,2,05,3,6,2,3,4,20,30,40,32,1,1,1",         # export leaving the state
]


@pytest.fixture
def fake_ctx(tmp_path: Path, monkeypatch) -> Context:
    root = tmp_path / "repo"
    (root / "config" / "states").mkdir(parents=True)
    (root / "data-raw" / "faf5").mkdir(parents=True)
    (root / "config" / "sources.yml").write_text(yaml.safe_dump(SOURCES), encoding="utf-8")
    (root / "config" / "app.yml").write_text("foreign_regions: {}\n", encoding="utf-8")
    (root / "config" / "states" / "testland.yml").write_text(yaml.safe_dump(TEST_STATE), encoding="utf-8")
    ctx = load_context("testland", root)
    # zone ids normally come from the metadata workbook; fixtures supply them directly
    monkeypatch.setattr("faf_pipeline.flows.state_zone_ids", lambda c, p: ["991", "999"])
    return ctx


def write_regional(ctx: Context, text: str) -> None:
    (ctx.paths.raw / "faf5" / "REGIONAL.csv").write_text(text, encoding="utf-8")


def write_state_csv(ctx: Context, text: str) -> None:
    (ctx.paths.raw / "faf5" / "STATE.csv").write_text(text, encoding="utf-8")
