"""Command-line entry point (stub; subcommands arrive in Phase 1)."""

import argparse

COMMANDS = ("fetch", "build", "zones", "network", "validate", "update")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="faf_pipeline",
        description="Build state-filtered FAF data products for the Freight Explorer.",
    )
    parser.add_argument("--state", help="state config name in config/states/ (without .yml)")
    sub = parser.add_subparsers(dest="command", metavar="<command>")
    for name in COMMANDS:
        sub.add_parser(name, help=f"{name} (not implemented yet)")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 0
    parser.error(f"'{args.command}' is not implemented yet")
    return 2
