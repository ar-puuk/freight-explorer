"""fetch -> build -> zones -> network -> validate, with a printed changelog."""

from __future__ import annotations

from typing import Any

from faf_pipeline import dictionary, dims, fetch, flows, meta, network, validate, webmeta, zones
from faf_pipeline.config import Context

FLOW_PRODUCTS = ["faf5", "faf6"]


def build_all(ctx: Context, products: list[str] | None = None, log=print) -> dict[str, Any]:
    """Dimension tables + flows for the selected FAF products (default: all), then state.json and versions.json."""
    prods = [p for p in (products or FLOW_PRODUCTS) if p in FLOW_PRODUCTS]
    log("dimensions")
    dims.build_dims(ctx, FLOW_PRODUCTS, log)
    log("flows")
    stats = flows.build(ctx, prods, log)
    meta.write_state(ctx)
    meta.write_versions(ctx, stats, None, None)
    return stats


def changelog(before: dict[str, Any], after: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    for p, e in after.get("products", {}).items():
        old = before.get("products", {}).get(p, {})
        new_years = sorted(set(e["years"]) - set(old.get("years", {})))
        if new_years and old:
            lines.append(f"{p}: new years {', '.join(new_years)}")
        for y, dv in e["years"].items():
            if y in old.get("years", {}) and old["years"][y] != dv:
                lines.append(f"{p}: {y} data_version {old['years'][y]} -> {dv}")
        for k, n in e["rows"].items():
            o = old.get("rows", {}).get(k)
            if o is not None and o != n:
                lines.append(f"{p}: {k} rows {o} -> {n}")
    return lines


def update(ctx: Context, log=print) -> int:
    before = meta.load_previous_versions(ctx)
    log("== fetch")
    changes = fetch.fetch(ctx, None, False, log)
    changes += fetch.probe_new_releases(ctx, log)
    log("== build")
    flow_stats = build_all(ctx, None, log)
    log("== zones")
    zone_stats = zones.build(ctx, FLOW_PRODUCTS, log)
    log("== network")
    net_stats = network.build(ctx, log)
    log("== dictionary / meta / web files")
    dictionary.build(ctx, log)
    webmeta.build(ctx, log)
    meta.write_state(ctx)
    after = meta.write_versions(ctx, flow_stats, zone_stats, net_stats)
    log("== validate")
    fails, report = validate.run(ctx, before, log)
    log("\n== changelog")
    for line in (changes + changelog(before, after)) or ["no changes"]:
        log("  " + line)
    log("\n== validation report")
    for k, v in report.items():
        log(f"  {k}: {v}")
    if fails:
        log("\nVALIDATION FAILED:")
        for f in fails:
            log("  - " + f)
        return 1
    log("\nvalidation passed")
    return 0
