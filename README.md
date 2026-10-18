# FAF Freight Explorer

A map-first, static, zero-cost explorer for Freight Analysis Framework (FAF) data, one state at a time. The state is set by one config file (`config/states/<name>.yml`); Utah is the target. See `HANDOFF.md` for the plan, `docs/SPIKES.md` for the Phase 0 findings and `docs/DECISIONS.md` for deviations.

Status: Phases 1 to 4 are done (pipeline, map app, charts and High/Low scenarios, 1997-2012 state history, experimental county estimates). The methodology page, accessibility/performance passes and open-source polish remain (see `HANDOFF.md` phase 5).

## Pipeline quickstart

Needs [uv](https://docs.astral.sh/uv/) and a network connection (first run downloads about 2.3 GB of source files into `data-raw/`, which is git-ignored; DuckDB also fetches its `spatial` and `excel` extensions once).

```
cd pipeline
uv run python -m faf_pipeline update --state utah        # fetch -> build -> zones -> network -> validate, prints a changelog
uv run python -m faf_pipeline fetch --state utah --check-only   # report changed files / new releases, download nothing
uv run python -m faf_pipeline validate --state utah
uv run pytest
```

Individual steps: `fetch`, `build` (dimensions + flows + dictionary), `zones`, `network`. Output goes to `docs/data/` (committed; every file under 90 MB). Re-running on unchanged inputs produces byte-identical files, so a second `update` leaves no git diff. Commit the outputs only after `validate` passes.

What is built for the configured state: every origin-destination record that touches the state, for FAF5.7.1 (mid-range, 2017 to 2050, regional and state databases) and FAF6.0 (2022), plus zone shapes and anchor points, the FAF5 highway network clipped to the state plus a buffer (PMTiles), and link-level truck flows for the 2017, 2022 and 2050 baseline assignments. It also builds the High and Low forecast scenarios, the FAF5-reprocessed state-level history (1997 to 2012), and the experimental county-level estimates (2022, tons only; state, adjacent-state counties and outside FAF zones) with their disaggregation factors.

## Web app

```
cd web
npm install
npm run dev        # local dev server (reads data from ../docs/data)
npm test           # vitest (URL state, SQL builders, formatting)
npm run check      # svelte-check
npm run build      # builds into ../docs (GitHub Pages root), replacing the old hashed assets
```

Stack: Vite, Svelte 5, MapLibre GL, deck.gl with flowmap.gl, PMTiles, DuckDB-WASM (self-hosted, EH build only). Everything is static; the page reads Parquet, GeoJSON and PMTiles from `docs/data/`.

## Adding a state

1. Copy `config/states/utah.yml` to `config/states/<name>.yml` and edit `name`, `abbrev`, `fips`, `bbox`, `center`, `zoom`, `site_title`. Nothing else names a state; the state's FAF zones are derived from the zone lookup (zone id prefix = `fips`).
2. `cd pipeline && uv run python -m faf_pipeline update --state <name>`.

Only Utah has been run. Other states are untested.

## When BTS releases a new FAF version

`fetch --check-only` probes for new release files. When a new file appears: point `config/sources.yml` at it, run `build --scaffold-map OLD_SCHEMA path/to/new.csv NEW_SCHEMA` to copy the column map and mark differences, fix the TODOs, classify any new years under `data_version`, then run `update`. The changelog lists new years and row-count changes.

## Data and attribution

Source data: BTS/FHWA/ORNL Freight Analysis Framework, U.S. Census Bureau (CFS geography, 2020 centers of population). Basemap: OpenFreeMap, OpenStreetMap. Link flows are a model product, not traffic counts.
