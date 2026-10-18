# FAF Freight Explorer

A map-first, static, zero-cost explorer for the public **Freight Analysis Framework (FAF)** data, one state at a time. Utah is the configured state; another state is a one-file change (see [Adding a state](#adding-a-state)).

**Live site:** https://ar-puuk.github.io/freight-explorer/ · **Methodology and data:** [methodology page](https://ar-puuk.github.io/freight-explorer/methodology.html)

![The map: origin-destination flow arcs, zone outlines, the FAF5 truck network and the headline numbers](docs/img/screenshot.jpg)

## What it shows

- **Origin-destination flows** (tons, value, ton-miles) for every record that touches the state, by commodity, mode and year, as a flow map: FAF5.7.1 (2017 to 2050) and FAF6.0 (2022), kept apart.
- **Forecast scenarios:** the mid-range forecast and FAF5's published High and Low scenarios, with forecast and preliminary years marked and the missing 2025 to 2029 shown as a gap.
- **Charts, a comparison mode, a table and CSV export** (every CSV row carries version, scenario, year, data status and dollar basis).
- **The FAF5 truck network** with modeled link volumes by year, truck type and market.
- **FAF5-reprocessed state history** (1997, 2002, 2007, 2012) and **experimental county-level estimates** (2022), each in its own clearly labeled place.

It shows data and caveats only. It does not rank places, score performance, forecast beyond the scenarios FAF publishes, present modeled values as measured counts, or imply local-scale accuracy.

## How it works

Everything is static: GitHub Pages serves `docs/`. Nothing runs on a server and nothing costs money.

1. **`pipeline/`** (Python with [uv](https://docs.astral.sh/uv/), DuckDB) downloads the real BTS/FHWA/ORNL/Census files into `data-raw/` (git-ignored; a manifest with URL, release and SHA-256 is committed), checks every file's columns against a column map, filters to the state, and writes deterministic Parquet, GeoJSON and PMTiles into `docs/data/`.
2. **`web/`** (Vite, Svelte 5, MapLibre, deck.gl and flowmap.gl, DuckDB-WASM, Observable Plot) builds into `docs/`. The browser reads the Parquet files directly and queries them with DuckDB-WASM; there is no backend.

```
config/states/<name>.yml   the only place a state appears
config/sources.yml         source URLs, releases, which years are final/preliminary/forecast
config/app.yml             UI defaults and the schematic foreign-region positions
pipeline/faf_pipeline/     fetch, schema guard, flows, zones, network, county, dictionary, validate
pipeline/tests/            pytest on tiny fixture files (a fictional state)
web/src/                   the app (lib/ has the URL state, SQL builders, map and controller)
docs/                      GitHub Pages root: built app, methodology page, docs/data/
data-raw/manifest.json     what was downloaded, from where, with hashes (the files themselves are not committed)
HANDOFF.md                 the original plan; docs/SPIKES.md and docs/DECISIONS.md record what was found and decided
```

## Quickstart

You need [uv](https://docs.astral.sh/uv/) and Node 22 or newer, and a network connection (the first pipeline run downloads about 2.5 GB into `data-raw/`; DuckDB also fetches its `spatial` and `excel` extensions once).

```
# data
cd pipeline
uv run python -m faf_pipeline update --state utah          # fetch, build, zones, county, network, validate; prints a changelog
uv run python -m faf_pipeline fetch --state utah --check-only   # report changed files and new releases; downloads nothing
uv run python -m faf_pipeline validate --state utah
uv run pytest

# app
cd ../web
npm install
npm run dev        # dev server; serves ../docs/data at /data
npm test           # vitest
npm run check      # svelte-check
npm run build      # builds the map and the methodology page into ../docs
```

Re-running `update` on unchanged inputs produces byte-identical files, so a second run leaves no git diff. Commit processed data only after `validate` passes; it checks key uniqueness, code lists, negative values, trade-type consistency, regional-to-state reconciliation for every year and scenario, link joins, the PMTiles file, file sizes under 90 MB, dictionary coverage, that the county estimates conserve FAF totals, and that no state name, abbreviation or zone id appears as a literal in the code.

## Adding a state

1. Copy `config/states/utah.yml` to `config/states/<name>.yml` and edit `name`, `abbrev`, `fips` (2 digits, as a string), `bbox` (west, south, east, north), `center`, `zoom`, `site_title`. Optionally `network_buffer_km`, and `overrides.county_zip_name` if BTS names the state's county zip differently from `name`.
2. `cd pipeline && uv run python -m faf_pipeline update --state <name>`.

The state's FAF zones are derived from the zone lookup (the first two characters of a zone id are the state FIPS), and the adjacent states for the county product are derived from the data. Nothing else needs editing.

**Smoke test, not a promise.** The same code was run once for Colorado (`fips` 08) in a scratch clone, with no code changes except one fix it exposed: the literal check flagged Colorado's FIPS `08` because it is also SCTG commodity code 08, so FIPS codes are now only checked in code files, not in YAML code tables. `update` took about 1.5 minutes with the source files already on disk and validated, and the app loaded with Colorado's data (2 FAF zones, 64 counties, a network clip of 8,980 links); the county estimates again reproduced FAF5.7.1's 2022 domestic tons by mode exactly. Large or unusual states (Alaska, Hawaii, Washington DC) have not been tried. Only Utah is the supported, tested state.

## Updating after BTS releases new data

`fetch --check-only` HEAD-probes the candidate file names listed under `probes` in `config/sources.yml` and reports changed file sizes. BTS publishes no release API, so edit the candidate list when a new version number is plausible. Then:

1. **New release file** (for example FAF6.1): point `config/sources.yml` at the new URLs and update `faf_version`, `benchmark_year` and `release`.
2. **Column changes:** `build --scaffold-map OLD_SCHEMA path/to/new.csv NEW_SCHEMA` copies a column map for the new header and marks differences with TODOs. Unmapped or missing columns fail the build with the nearest names; nothing is guessed.
3. **New years** (for example when FAF6 adds annual years): `<measure>_<YYYY>` columns are accepted without a schema edit, but every year must be classified under `data_version` in `config/sources.yml` (base, final, preliminary, or `forecast_from`), taken from the [BTS version history](https://www.bts.gov/faf/versions). An unclassified year stops the build on purpose.
4. **Ton-miles or current-dollar values appearing in FAF6:** the schema already maps `tmiles_YYYY` and `current_value_YYYY`, and the app finds out what is published from the data (NULL means "not published"), so the Ton-miles and Current dollars options switch on by themselves. Then update the wording that says FAF6.0 has neither: the caveats in `pipeline/faf_pipeline/schemas/dictionary.yml` and `web/src/methodology/Methodology.svelte`.
5. **FAF6 High/Low files:** add `regional_hilo` and `state_hilo` entries under `faf6` in `config/sources.yml` and copy the `faf5_*_hilo.yml` column maps.
6. **History rebuilt on the FAF6 benchmark, or new network assignments:** update the `history` product or `network.assignments` in `config/sources.yml` (and `benchmark_year` and the dollar-year wording in the dictionary).
7. `update --state <name>`: the changelog lists new years, changed row counts and new files; fix anything `validate` reports; commit `docs/data`, `data-raw/manifest.json` and any config changes together; `npm run build`; push.

## Deployment

GitHub Pages from the `main` branch, `/docs` folder. There are no GitHub Actions: build locally, commit, push. `docs/.nojekyll` is required. The app uses relative paths, so it also works under a project URL such as `/freight-explorer/`.

## Performance and accessibility

- First paint needs about 1.1 MB of gzipped JavaScript, the zone shapes and a 60-flow headline file. On the live site (measured with headless Chromium) the first arcs appear in well under a second and the full query engine is ready in about two seconds. The 36 MB DuckDB-WASM binary (about 8 MB gzipped) starts loading after first paint. The chart code loads the first time the Charts panel opens, and the all-years data (about 11 MB for FAF5.7.1 including High/Low) loads once when you open Trends or Compare.
- GitHub Pages does not serve Parquet by byte range to DuckDB-WASM, so each file is fetched whole; the data is therefore partitioned into small per-year files.
- Tested with axe-core (WCAG 2.0, 2.1 and 2.2 level A and AA, including target size) on every view in light and dark themes, on desktop and a 390 px phone layout, plus keyboard operation (skip links, a visible focus ring on every control, a zone picker as a keyboard alternative to clicking the map, Escape closes details), 320 px reflow and reduced motion. The map itself is a canvas: its largest flows are also listed as text, and every chart has a data table. This is not a substitute for testing with assistive technology.
- If the basemap service is unreachable, flows, zones and the network still work on a plain background. A content-security policy restricts the page to its own files and OpenFreeMap.

## Known limitations

- Only Utah is supported and tested. Other FAF zones and counties appear only as the other end of Utah's flows.
- FAF6.0 has a single year and no ton-miles; FAF5 has no 2025 to 2029; High and Low have tons and value only.
- The network flows are a FAF5.3-era model assignment, not updated to FAF5.7.1 or FAF6 and not traffic counts.
- The county-level product is experimental and its import and export totals differ slightly from FAF5.7.1 for reasons not established here.
- The FAF6 constant-dollar year (2022) is taken from the release notes and was not independently verified. Zone anchors are drawing aids, and the eight foreign regions have schematic positions.
- Tested in Chromium (headless, software rendering). Firefox, Safari, a real GPU and real phones have not been tested.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please report data questions with the release, year and view, and the URL from your address bar (the whole state of the view is in it).

## Data and attribution

Data: Freight Analysis Framework, Bureau of Transportation Statistics, Federal Highway Administration and Oak Ridge National Laboratory; U.S. Census Bureau (CFS geography, 2020 centers of population, 2022 cartographic boundaries). These are U.S. government public data. Cite the original FAF source (DOIs on the methodology page), not this site. Basemap: [OpenFreeMap](https://openfreemap.org), data (c) [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

Code: [MIT license](LICENSE).
