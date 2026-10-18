"""Repository paths and config loading. The state config is the only place a state's identity lives."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


class ConfigError(Exception):
    pass


def find_repo_root(start: Path | None = None) -> Path:
    here = (start or Path(__file__)).resolve()
    for p in [here, *here.parents]:
        if (p / "config" / "sources.yml").exists():
            return p
    raise ConfigError("could not find repo root (no config/sources.yml above %s)" % here)


@dataclass(frozen=True)
class State:
    slug: str            # config file stem, used for file names
    name: str
    abbrev: str
    fips: str
    bbox: tuple[float, float, float, float]
    center: tuple[float, float]
    zoom: float
    site_title: str
    network_buffer_km: float
    overrides: dict[str, Any]

    @classmethod
    def from_dict(cls, slug: str, d: dict[str, Any]) -> State:
        missing = [k for k in ("name", "abbrev", "fips", "bbox", "center", "zoom", "site_title", "network_buffer_km") if k not in d]
        if missing:
            raise ConfigError(f"state config {slug}.yml is missing: {', '.join(missing)}")
        fips = str(d["fips"])
        if len(fips) != 2 or not fips.isdigit():
            raise ConfigError(f"state fips must be a 2-digit string, got {d['fips']!r}")
        return cls(
            slug=slug, name=d["name"], abbrev=d["abbrev"], fips=fips, bbox=tuple(float(x) for x in d["bbox"]),
            center=tuple(float(x) for x in d["center"]), zoom=float(d["zoom"]), site_title=d["site_title"],
            network_buffer_km=float(d["network_buffer_km"]), overrides=d.get("overrides") or {},
        )


@dataclass(frozen=True)
class Paths:
    root: Path

    @property
    def config(self) -> Path: return self.root / "config"
    @property
    def raw(self) -> Path: return self.root / "data-raw"
    @property
    def extract(self) -> Path: return self.raw / "_extract"
    @property
    def manifest(self) -> Path: return self.raw / "manifest.json"
    @property
    def out(self) -> Path: return self.root / "docs" / "data"
    @property
    def schemas(self) -> Path: return Path(__file__).parent / "schemas"
    @property
    def sql(self) -> Path: return Path(__file__).parent / "transform"


@dataclass(frozen=True)
class Context:
    paths: Paths
    state: State
    sources: dict[str, Any]
    app: dict[str, Any]


def load_yaml(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return data or {}


def load_context(state_slug: str, root: Path | None = None) -> Context:
    paths = Paths(root or find_repo_root())
    state_file = paths.config / "states" / f"{state_slug}.yml"
    if not state_file.exists():
        have = sorted(p.stem for p in (paths.config / "states").glob("*.yml"))
        raise ConfigError(f"no state config {state_file.name}; available: {', '.join(have) or 'none'}")
    return Context(
        paths=paths,
        state=State.from_dict(state_slug, load_yaml(state_file)),
        sources=load_yaml(paths.config / "sources.yml"),
        app=load_yaml(paths.config / "app.yml"),
    )
