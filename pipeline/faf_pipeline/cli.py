"""Command-line entry point: python -m faf_pipeline <command> --state <name>."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from faf_pipeline import __version__


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="faf_pipeline", description="Build state-filtered FAF data products for the Freight Explorer.")
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", metavar="<command>")

    def common(p: argparse.ArgumentParser) -> argparse.ArgumentParser:
        p.add_argument("--state", required=True, help="state config name in config/states/ (without .yml)")
        return p

    p = common(sub.add_parser("fetch", help="download source files and update data-raw/manifest.json"))
    p.add_argument("--product", action="append", help="faf5, faf6, network, census_county_centers (repeatable; default all)")
    p.add_argument("--check-only", action="store_true", help="HEAD-check sizes and probe for new releases; download nothing")

    p = common(sub.add_parser("build", help="dimensions + state-touching flows (Parquet per version/year), then the dictionary"))
    p.add_argument("--product", action="append", help="faf5 or faf6 (repeatable; default both)")
    p.add_argument("--scaffold-map", nargs=3, metavar=("SCHEMA", "CSV", "NEW_SCHEMA"),
                   help="copy column map SCHEMA for the header of CSV into schemas/NEW_SCHEMA.yml, marking differences; builds nothing")

    for name, text in (("zones", "zone GeoJSON, anchors, dim_zone, foreign regions"),
                       ("network", "network clip, link attributes, link flows, PMTiles"),
                       ("validate", "validate outputs (non-zero exit on failure)"),
                       ("update", "fetch -> build -> zones -> network -> validate, printing a changelog")):
        common(sub.add_parser(name, help=text))
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 0

    from faf_pipeline.config import ConfigError, load_context
    from faf_pipeline.schema import SchemaError
    try:
        ctx = load_context(args.state)
        if args.command == "fetch":
            from faf_pipeline.fetch import fetch, probe_new_releases
            lines = fetch(ctx, args.product, args.check_only)
            if args.check_only:
                lines += probe_new_releases(ctx)
            print("\n".join(lines) if lines else "up to date")
            return 0
        if args.command == "build":
            if args.scaffold_map:
                from faf_pipeline.duck import connect
                from faf_pipeline.flows import _read_header
                from faf_pipeline.schema import scaffold_map
                header = _read_header(connect(), Path(args.scaffold_map[1]))
                print("wrote", scaffold_map(ctx, args.scaffold_map[0], header, args.scaffold_map[2]))
                return 0
            from faf_pipeline import dictionary, webmeta
            from faf_pipeline.update import build_all
            build_all(ctx, args.product)
            dictionary.build(ctx)
            webmeta.build(ctx)
            return 0
        if args.command == "zones":
            from faf_pipeline import meta, zones
            from faf_pipeline.update import FLOW_PRODUCTS
            meta.write_versions(ctx, None, zones.build(ctx, FLOW_PRODUCTS), None)
            return 0
        if args.command == "network":
            from faf_pipeline import meta, network
            meta.write_versions(ctx, None, None, network.build(ctx))
            return 0
        if args.command == "validate":
            from faf_pipeline import meta, validate
            fails, report = validate.run(ctx, meta.load_previous_versions(ctx))
            for k, v in report.items():
                print(f"{k}: {v}")
            for f in fails:
                print("FAIL:", f)
            return 1 if fails else 0
        if args.command == "update":
            from faf_pipeline.update import update
            return update(ctx)
    except (ConfigError, SchemaError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    parser.error(f"unknown command {args.command}")
    return 2
