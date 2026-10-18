"""docs/data/meta/state.json and versions.json. Deterministic: no timestamps, sorted keys."""

from __future__ import annotations

import json
from typing import Any

from faf_pipeline.config import Context
from faf_pipeline.dims import state_zone_ids
from faf_pipeline.duck import write_json
from faf_pipeline.fetch import load_manifest
from faf_pipeline.webmeta import default_year


def load_previous_versions(ctx: Context) -> dict[str, Any]:
    p = ctx.paths.out / "meta" / "versions.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def write_state(ctx: Context, county_counties: list[str] | None = None) -> None:
    s = ctx.state
    prev = {}
    p0 = ctx.paths.out / "meta" / "state.json"
    if p0.exists():
        prev = json.loads(p0.read_text(encoding="utf-8")).get("zones", {})
    write_json({
        "name": s.name, "abbrev": s.abbrev, "fips": s.fips, "slug": s.slug,
        "bbox": list(s.bbox), "center": list(s.center), "zoom": s.zoom, "site_title": s.site_title,
        "network_buffer_km": s.network_buffer_km,
        "zones": {
            **{ctx.sources["products"][p]["faf_version"]: state_zone_ids(ctx, p) for p in ("faf5", "faf6")},
            # the county product's "zones" are the state's counties (county FIPS)
            **({ctx.sources["products"]["county"]["faf_version"]: county_counties or prev.get(ctx.sources["products"]["county"]["faf_version"], [])}
               if "county" in ctx.sources["products"] and (county_counties or prev.get(ctx.sources["products"]["county"]["faf_version"])) else {}),
        },
        "network_pmtiles": f"network/{s.slug}_network.pmtiles",
    }, ctx.paths.out / "meta" / "state.json")


def write_versions(ctx: Context, flow_stats: dict[str, Any] | None, zone_stats: dict[str, Any] | None,
                   network_stats: dict[str, Any] | None, county_stats: dict[str, Any] | None = None) -> dict[str, Any]:
    """Merge new stats into the previous versions.json (a step that did not run keeps its earlier entry)."""
    manifest = {e["path"]: e for e in load_manifest(ctx)}
    out: dict[str, Any] = load_previous_versions(ctx) or {"products": {}, "network": None}
    out.setdefault("products", {})
    for p, levels in (flow_stats or {}).items():
        spec = ctx.sources["products"][p]
        entry: dict[str, Any] = {
            "kind": "history" if p == "history" else "flows",
            "faf_version": spec["faf_version"], "benchmark_year": spec["benchmark_year"], "release": spec["release"],
            "scenario": spec["scenario"], "years": {}, "rows": {}, "sources": {},
            "zones": (zone_stats or {}).get(p, {}).get("zones") or out["products"].get(p, {}).get("zones"),
        }
        all_years = sorted({y for st in levels.values() for y in st["years"]})
        entry["default_year"] = default_year(spec["data_version"], all_years)
        for level, st in levels.items():
            folder = "flows" if level == "regional" else "state_flows"
            for y, v in st["years"].items():
                entry["years"][str(y)] = v["data_version"]
                entry["rows"][f"{folder}/{y}"] = v["rows"]
            for sc, scd in (st.get("scenarios") or {}).items():
                e = entry.setdefault("scenarios", {}).setdefault(sc, {"years": {}, "rows": {}})
                for y, v in scd["years"].items():
                    e["years"][str(y)] = v["data_version"]
                    e["rows"][f"{folder}/{y}"] = v["rows"]
            url = spec["files"][level]["url"]
            hl = spec["files"].get(f"{level}_hilo")
            if hl:
                for m in manifest.values():
                    if m["source_url"] == hl["url"]:
                        entry["sources"][f"{level}_hilo"] = {"url": m["source_url"], "sha256": m["sha256"], "bytes": m["bytes"]}
            for m in manifest.values():
                if m["source_url"] == url:
                    entry["sources"][level] = {"url": m["source_url"], "sha256": m["sha256"], "bytes": m["bytes"]}
        out["products"][p] = entry
    for p, zs in (zone_stats or {}).items():
        if p in out["products"]:
            out["products"][p]["zones"] = zs.get("zones")
    if county_stats:
        cs = ctx.sources["products"]["county"]
        srcs = {}
        for role, url_ in (("tables", None), ("factors", cs["files"]["factors"]["url"])):
            for m in manifest.values():
                if (url_ and m["source_url"] == url_) or (role == "tables" and m["path"].startswith("data-raw/county/") and m["path"].endswith(".zip") and "Factors" not in m["path"]):
                    srcs[role] = {"url": m["source_url"], "sha256": m["sha256"], "bytes": m["bytes"]}
        out["products"]["county"] = {
            "kind": "county", "experimental": True, "label": cs["label"], "faf_version": cs["faf_version"], "benchmark_year": None,
            "release": cs["release"], "scenario": "mid", "years": {str(cs["year"]): "experimental"}, "default_year": cs["year"],
            "rows": {f"flows/{cs['year']}": county_stats["rows"]}, "rows_by_table": county_stats["rows_by_table"],
            "adjacent_states": county_stats["adjacent_states"], "factors_rows": county_stats["factors_rows"], "sources": srcs,
        }
    if network_stats:
        out["network"] = {
            "release": ctx.sources["products"]["network"]["release"],
            "links_in_clip": network_stats["links_in_clip"], "links_in_state": network_stats["links_in_state"],
            "buffer_km": network_stats["buffer_km"],
            "years": {str(y): v for y, v in network_stats["flows"].items()},
        }
    write_json(out, ctx.paths.out / "meta" / "versions.json")
    return out
