# Decisions and deviations

Locked decisions in HANDOFF.md section 2 are unchanged. Entries below are deviations or Phase 0 choices, each needing your OK where marked.

## 2026-10-18

1. **Python pinned to 3.14** (`pipeline/.python-version`, `requires-python >=3.14`). Latest stable 3.x uv 0.10.8 lists; 3.15 is alpha. Why: you asked for the latest stable.
2. **TypeScript pinned to ^6.0.3** in `web/`. Why: `svelte-check@4.7.7` peers `typescript ^5 || ^6`; 7.0.2 fails `npm install` without `--legacy-peer-deps`. Revisit when svelte-check supports 7.
3. **PMTiles built with DuckDB's GDAL writer, not tippecanoe.** Why: tippecanoe is not installed on the maintainer's machine and DuckDB spatial's PMTiles driver produced a valid 2.4 MB file. Trade-off: no per-zoom feature dropping. Not a spending change; no extra tools. Keeps the pipeline dependency set at Python + DuckDB.
4. **Parquet partitioned small (per version x scenario x year) and not assumed range-readable on Pages.** Why: measured, DuckDB-WASM does full GETs there (docs/SPIKES.md section 8). Needs no spending change.
5. **Ship only the EH build of DuckDB-WASM** (36 MB) in the spike, not the MVP build (41 MB). Why: repo size; EH is supported by current Chrome, Firefox, Safari. Trade-off: very old browsers fail. **Needs your OK** before Phase 2 (alternative: ship both, +41 MB once; the binary only changes when DuckDB-WASM is upgraded, so git history growth is per-upgrade).
6. **GitHub Pages was enabled via `gh api` and the spike plus ~11 MB of spike data were pushed to `main`.** Why: HANDOFF Phase 0 requires live range tests. `docs/spike.html`, `docs/assets/` and `docs/data/_spike/` are throwaway; remove in Phase 2.
7. **Raw-file naming/layout in `data-raw/`:** `faf5/ faf6/ history/ zones/ network/ county/` plus gitignored scratch `data-raw/x/` (extracted files, profiling output). Only `manifest.json` is tracked. The manifest records the 15 files fetched (the 2050 network/CSV extracted via range reads from the 2050 zip is not listed; it lives in `data-raw/network/x50/`).
8. **`utah.yml` bbox kept** at `[-114.06, 36.99, -109.04, 42.01]` after verification against the real zone geometry.

## Proposed, not yet decided (need your call)

- **Zone anchor points for flowmap.gl.** `ST_PointOnSurface` puts Utah's `491` zone in Tooele County, away from the Salt Lake City urban core. Options: (a) FAF5 shapefile `INTPTLAT/INTPTLON` plus an equivalent for FAF6, (b) population-weighted centroid from a county layer (new dependency: Census county population/geometry, still public data), (c) accept geometric points and label them "zone anchor". Recommendation: (b) if you are OK adding Census county files to `data-raw`, else (a)/(c).
- **Network centroid connectors (`Class` = 50) and ramps.** Recommendation: hide `Class` 50 from the default map layer, keep them in the data, and say so in Methodology.
- **Zero-flow rows.** Recommendation: drop rows where all measures are zero in a given year when unpivoting; do not store NULL for them.
