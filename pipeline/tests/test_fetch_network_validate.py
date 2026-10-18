from __future__ import annotations

import functools
import hashlib
import http.server
import threading

import pytest
import yaml

from faf_pipeline import fetch, validate
from faf_pipeline.config import ConfigError, load_context
from faf_pipeline.network import _parse_table

GROUPS = {"Farm Products": {"slug": "farm"}, "Mixed Freight": {"slug": "mixed"}}


def table_header(token="17", typ="All", groups=("Farm Products", "Mixed Freight")):
    cols = ["ID"]
    for d in ("AB", "BA", "TOT"):
        for m in ("Tons", "Trips"):
            cols.append(f"{d} {m}_{token} {typ}")
    for g in groups:
        for d in ("AB", "BA", "TOT"):
            for m in ("Tons", "Trips"):
                cols.append(f"{d} {g}-{m}_{token} {typ}")
    return cols


def test_assignment_header_parses_groups_and_all():
    found = _parse_table(table_header(), "All", "17", GROUPS)
    assert set(found) == {"all", "farm", "mixed"}
    assert found["all"]["tot_trips_day"] == "TOT Trips_17 All"
    assert found["farm"]["ab_tons_k"] == "AB Farm Products-Tons_17 All"


def test_assignment_header_rejects_unknown_group_and_wrong_tokens():
    with pytest.raises(ConfigError, match="unknown commodity group"):
        _parse_table(table_header(groups=("Farm Products", "Mixed Freight", "Mystery")), "All", "17", GROUPS)
    with pytest.raises(ConfigError, match="year token"):
        _parse_table(table_header(token="22"), "All", "17", GROUPS)
    with pytest.raises(ConfigError, match="type token"):
        _parse_table(table_header(typ="Dom"), "All", "17", GROUPS)
    with pytest.raises(ConfigError, match="missing from table"):
        _parse_table(table_header(groups=("Farm Products",)), "All", "17", GROUPS)


def test_state_literal_scan_flags_hardcoded_state(fake_ctx, monkeypatch):
    monkeypatch.setattr("faf_pipeline.dims.state_zone_ids", lambda c, p: ["991", "999"])
    code = fake_ctx.paths.root / "pipeline" / "faf_pipeline"
    code.mkdir(parents=True)
    (code / "clean.py").write_text("x = 1\n", encoding="utf-8")
    assert validate.scan_state_literals(fake_ctx) == []
    (code / "bad.py").write_text("name = 'Testland'\nzone = '991'\nfips = \"99\"\n", encoding="utf-8")
    hits = validate.scan_state_literals(fake_ctx)
    assert any("state name" in h for h in hits) and any("zone id '991'" in h for h in hits) and any("fips '99'" in h for h in hits)


def test_real_repo_has_no_state_literals():
    """Run against the real repository and state config; the HANDOFF rule is 'no state literal anywhere in code'."""
    from faf_pipeline.config import find_repo_root
    for cfg in sorted((find_repo_root() / "config" / "states").glob("*.yml")):
        assert validate.scan_state_literals(load_context(cfg.stem)) == [], cfg.stem


@pytest.fixture
def server(tmp_path):
    root = tmp_path / "www"
    root.mkdir()
    (root / "thing.zip").write_bytes(b"not really a zip" * 100)
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}", root
    httpd.shutdown()


def test_fetch_records_manifest_is_idempotent_and_check_only_reports(tmp_path, server):
    base, www = server
    root = tmp_path / "repo"
    (root / "config" / "states").mkdir(parents=True)
    (root / "data-raw").mkdir()
    sources = {"products": {"faf5": {"faf_version": "9", "release": "fx", "files": {"regional": {"url": f"{base}/thing.zip", "member": "a.csv"}}}}}
    (root / "config" / "sources.yml").write_text(yaml.safe_dump(sources), encoding="utf-8")
    (root / "config" / "app.yml").write_text("{}\n", encoding="utf-8")
    from tests.conftest import TEST_STATE
    (root / "config" / "states" / "t.yml").write_text(yaml.safe_dump(TEST_STATE), encoding="utf-8")
    ctx = load_context("t", root)

    assert fetch.fetch(ctx, None, True, log=lambda *_: None)[0].startswith("NOT-FETCHED")
    changes = fetch.fetch(ctx, None, False, log=lambda *_: None)
    assert changes and changes[0].startswith("NEW")
    entry = fetch.load_manifest(ctx)[0]
    data = (root / "data-raw" / "faf5" / "thing.zip").read_bytes()
    assert entry["sha256"] == hashlib.sha256(data).hexdigest() and entry["bytes"] == len(data)
    manifest_text = ctx.paths.manifest.read_text(encoding="utf-8")

    assert fetch.fetch(ctx, None, False, log=lambda *_: None) == []         # second run: nothing to do
    assert ctx.paths.manifest.read_text(encoding="utf-8") == manifest_text   # manifest unchanged
    assert fetch.fetch(ctx, None, True, log=lambda *_: None) == []           # check-only: up to date

    (www / "thing.zip").write_bytes(b"changed on the server" * 50)
    assert fetch.fetch(ctx, None, True, log=lambda *_: None)[0].startswith("CHANGED")


def test_fips_is_not_flagged_inside_yaml_code_tables(fake_ctx, monkeypatch):
    """A state's 2-digit FIPS can equal a valid SCTG code (e.g. 08); data tables are not code, so only code files are checked for it."""
    monkeypatch.setattr("faf_pipeline.dims.state_zone_ids", lambda c, p: ["991", "999"])
    schemas = fake_ctx.paths.root / "pipeline" / "faf_pipeline" / "schemas"
    schemas.mkdir(parents=True)
    (schemas / "groups.yml").write_text('groups:\n  Something: {sctg: ["98", "99"]}\n', encoding="utf-8")
    assert validate.scan_state_literals(fake_ctx) == []
    (schemas / "oops.yml").write_text('zone: "991"\n', encoding="utf-8")          # a derived zone id is still flagged anywhere
    assert any("zone id '991'" in h for h in validate.scan_state_literals(fake_ctx))
