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

## Decided 2026-10-18 (your call on the Phase 0 proposals: "go with your recommendations")

- **Zone anchor points:** population-weighted mean of the Census 2020 county centers of population that fall inside each zone (new public input: `CenPop2020_Mean_CO.txt`, in `config/sources.yml`, recorded in the manifest). If that point falls outside the zone polygon, the most populous county center inside is used; if no county center falls inside, `ST_PointOnSurface`. The method is stored per zone in `dim_zone.anchor_method`. Result: FAF5 123 of 132 zones population-weighted, 9 fell back; FAF6 124 of 134, 10 fell back. The state's Salt Lake zone now anchors in the Salt Lake Valley instead of the western desert.
- **Network centroid connectors (`Class` 50):** kept in the data (`road_class` = 50, flagged in the dictionary caveat); the Phase 2 map hides them by default. Nothing is filtered out in the pipeline.
- **Zero-flow rows:** dropped when every measure is zero for that (key, year); NULL always means "not published" (e.g. FAF5 `value_current_musd` for 2017 and forecasts, FAF6 `tmiles_m`), never 0.
- **DuckDB-WASM:** EH build only (36 MB), as recommended. Takes effect in Phase 2; the spike already does this.

## Phase 1 choices and deviations

1. **Canonical column names** (all documented in `dictionary.parquet`): `tons_kt` (thousand tons), `value_const_musd`, `value_current_musd`, `tmiles_m`; zone fields `dms_orig`/`dms_dest` (regional) and `dms_orig_st`/`dms_dest_st` (state database); `dist_band` is kept for FAF5 (NULL column absent in FAF6 files). The dictionary table uses `table_name` and `column_name` because `table`/`column` are awkward SQL names.
2. **Output layout:** `docs/data/<faf5|faf6>/flows/<scenario>/<year>.parquet` (regional), `.../state_flows/<scenario>/<year>.parquet`, `docs/data/network/{<state-slug>_network.pmtiles, link_attrs.parquet, link_flows/<year>.parquet}`, `docs/data/geo/{faf5_zones,faf6_zones}.geojson, zone_centroids.json, foreign_regions.json`, `docs/data/meta/{state.json, versions.json, dictionary.parquet, dim_*.parquet}`. The PMTiles file name comes from the state config file stem, not a literal.
3. **Link flows are long:** `link_id, year, truck_type (all|su|cu), market (total|domestic|import|export), commodity_group (12 FHWA groups + all), ab/ba/tot tons_k and trips_day`. About 2 MB per model year for the state's clip.
4. **Clip buffer is computed in a local azimuthal equidistant projection** centred on the state polygon (not a US-wide CRS), so it also works for Alaska/Hawaii-style states. The clip must contain every link tagged with the state FIPS or the build fails.
5. **`build --scaffold-map` takes `SCHEMA CSV NEW_SCHEMA`** (copy an existing column map for a new release's header), not `<product> <version>` as written in HANDOFF; it needs the new file path anyway.
6. **DuckDB extensions `spatial` and `excel` are installed from DuckDB's extension repository on first use** (a network dependency per machine; no cost).
7. **`data_version` classes live in `config/sources.yml`.** A year present in a file but not classified there fails the build. For FAF6 I set `base: [2022]` and `forecast_from: 2023` as a placeholder policy; revisit when BTS publishes FAF6 annual years.
8. **Hi/Lo scenarios, state history and county product are not built yet** (Phases 3 and 4). The data model already carries `scenario`; Phase 0 profiles in `docs/SPIKES.md`.
9. **Tests** live in `pipeline/tests` (fixtures only, a fictional state `Testland`, fips 99). Run `uv run pytest` from `pipeline/`. A test also asserts the real repo contains no state literal.
