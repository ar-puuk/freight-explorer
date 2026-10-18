"""Download source files, record sha256/size in data-raw/manifest.json, extract members, probe for new releases."""

from __future__ import annotations

import hashlib
import json
import zipfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from urllib.parse import unquote, urlparse

import httpx

from faf_pipeline.config import ConfigError, Context

_DIR_FOR_PRODUCT = {"census_county_centers": "census"}    # everything else lives in data-raw/<product>/


@dataclass(frozen=True)
class Item:
    product: str
    role: str
    url: str
    release: str
    dest: Path
    member: str | None = None        # file inside the zip that downstream steps need
    member_dir: str | None = None    # directory inside the zip (e.g. a geodatabase)


def _basename(url: str) -> str:
    return unquote(Path(urlparse(url).path).name)


def plan(ctx: Context, products: list[str] | None = None) -> list[Item]:
    items: list[Item] = []
    for product, spec in ctx.sources["products"].items():
        if products and product not in products:
            continue
        release = spec.get("release", product)
        for role, f in (spec.get("files") or {}).items():
            sub = _DIR_FOR_PRODUCT.get(product, product)
            items.append(Item(product, role, f["url"], release, ctx.paths.raw / sub / _basename(f["url"]),
                              f.get("member"), f.get("member_dir")))
        if "zones" in spec:
            z = spec["zones"]
            items.append(Item(product, "zones", z["url"], release, ctx.paths.raw / "zones" / _basename(z["url"]), z.get("member")))
        for a in spec.get("assignments") or []:
            items.append(Item(product, f"assignment_{a['year']}", a["url"], release,
                              ctx.paths.raw / "network" / _basename(a["url"]), None, a.get("member_dir")))
    return items


def load_manifest(ctx: Context) -> list[dict]:
    if ctx.paths.manifest.exists():
        data = json.loads(ctx.paths.manifest.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    return []


def save_manifest(ctx: Context, entries: list[dict]) -> None:
    entries = sorted(entries, key=lambda e: e["path"])
    ctx.paths.manifest.write_text(json.dumps(entries, indent=2) + "\n", encoding="utf-8", newline="\n")


def _rel(ctx: Context, p: Path) -> str:
    return p.resolve().relative_to(ctx.paths.root.resolve()).as_posix()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _download(url: str, dest: Path) -> tuple[str, int]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    h = hashlib.sha256()
    size = 0
    with httpx.stream("GET", url, follow_redirects=True, timeout=httpx.Timeout(60.0, read=300.0)) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
                h.update(chunk)
                size += len(chunk)
    tmp.replace(dest)
    return h.hexdigest(), size


def fetch(ctx: Context, products: list[str] | None = None, check_only: bool = False, log=print) -> list[str]:
    """Ensure every planned file is present and recorded. Returns a changelog (list of lines)."""
    manifest = {e["path"]: e for e in load_manifest(ctx)}
    changes: list[str] = []
    for item in plan(ctx, products):
        rel = _rel(ctx, item.dest)
        entry = manifest.get(rel)
        if check_only:
            try:
                r = httpx.head(item.url, follow_redirects=True, timeout=30.0)
                remote = int(r.headers.get("content-length", -1)) if r.status_code == 200 else None
            except httpx.HTTPError as e:
                changes.append(f"UNREACHABLE {item.url} ({e})")
                continue
            if remote is None:
                changes.append(f"MISSING-REMOTE {item.url} (HTTP {r.status_code})")
            elif entry is None:
                changes.append(f"NOT-FETCHED {rel} ({remote} bytes available)")
            elif entry["bytes"] != remote:
                changes.append(f"CHANGED {rel}: manifest {entry['bytes']} bytes, remote {remote} bytes")
            continue
        if item.dest.exists() and entry and entry["bytes"] == item.dest.stat().st_size and entry["source_url"] == item.url:
            continue
        if item.dest.exists() and not (entry and entry["source_url"] == item.url):
            sha, size = sha256_file(item.dest), item.dest.stat().st_size      # adopt a file already on disk
            log(f"adopting existing {rel}")
        else:
            log(f"downloading {item.url}")
            sha, size = _download(item.url, item.dest)
        if entry and entry["sha256"] == sha:
            continue
        manifest[rel] = {"path": rel, "source_url": item.url, "release": item.release, "sha256": sha,
                         "bytes": size, "retrieved": date.today().isoformat()}
        changes.append(f"{'UPDATED' if entry else 'NEW'} {rel} ({size} bytes)")
    if not check_only:
        save_manifest(ctx, list(manifest.values()))
    return changes


def probe_new_releases(ctx: Context, log=print) -> list[str]:
    """HEAD-probe predictable URLs for releases newer than the configured ones. Never downloads."""
    found: list[str] = []
    for product, spec in ctx.sources["products"].items():
        for pr in spec.get("probes") or []:
            for cand in pr["candidates"]:
                url = pr["pattern"].format(v=cand)
                try:
                    r = httpx.head(url, follow_redirects=True, timeout=30.0)
                except httpx.HTTPError:
                    continue
                if r.status_code == 200:
                    found.append(f"NEW RELEASE? {product} {cand}: {url} ({r.headers.get('content-length', '?')} bytes)")
    return found


def extract_member(zip_path: Path, member: str, out_dir: Path) -> Path:
    """Extract one member (or, for a trailing '/', a whole directory) and return its local path."""
    out_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        names = z.namelist()
        if member.endswith("/") or not any(n == member for n in names):
            prefix = member if member.endswith("/") else member + "/"
            hits = [n for n in names if n.startswith(prefix) and not n.endswith(".lock")]
            if not hits and not member.endswith("/"):
                raise ConfigError(f"{member!r} not found in {zip_path.name}")
            for n in hits:
                if not (out_dir / n).exists():
                    z.extract(n, out_dir)
            return out_dir / member.rstrip("/")
        target = out_dir / member
        # a shapefile needs its sidecar files (.dbf, .shx, .prj, ...) next to it
        group = [n for n in names if n.rsplit(".", 1)[0] == member.rsplit(".", 1)[0]] if member.lower().endswith(".shp") else [member]
        for n in group:
            if not (out_dir / n).exists() or (out_dir / n).stat().st_size != z.getinfo(n).file_size:
                z.extract(n, out_dir)
        return target


def local_path(ctx: Context, product: str, role: str) -> Path:
    for it in plan(ctx, [product]):
        if it.role == role:
            return it.dest
    raise ConfigError(f"no source {product}/{role} in sources.yml")


def extracted(ctx: Context, product: str, role: str) -> Path:
    """Local path of the (extracted) file for a source, extracting from its zip if needed."""
    for it in plan(ctx, [product]):
        if it.role != role:
            continue
        if it.dest.suffix.lower() != ".zip":
            return it.dest
        out = ctx.paths.extract / product
        if it.member:
            return extract_member(it.dest, it.member, out)
        if it.member_dir:
            return extract_member(it.dest, it.member_dir, out)
        raise ConfigError(f"{product}/{role} is a zip without member/member_dir")
    raise ConfigError(f"no source {product}/{role} in sources.yml")
