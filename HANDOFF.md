# HANDOFF: FAF Freight Explorer (state-configurable, static, zero-cost)

> **How to use this file:** put it in the root of an empty project folder (rename to `CLAUDE.md` if you want Claude Code to auto-load it every session). Then start with the "First session prompt" at the bottom.
> Written 2026-10-18. Everything marked **[VERIFY]** was NOT confirmed when this was written. Claude Code must check it against the live source (download it, read it) before relying on it. Do not trust URL patterns, column names, units, or table structures from memory, including those in this file.
> Sibling project for conventions: `ar-puuk/education-explorer` (NCES Education Explorer). Reuse its patterns (config contract, schema-drift guard, deterministic Parquet, theme tokens, basemap switcher, URL state) wherever they apply.

---

## 1. Goal

A clean, map-first dashboard that lets planners and the public explore **all publicly available Freight Analysis Framework (FAF) data** for **one state at a time**: commodity flows (tons, value, ton-miles) by origin, destination, commodity, mode, and year, plus the FAF zone geographies and the FAF truck-flow highway network. FAF is public but awkward (national CSVs of hundreds of MB, Access files, wide year columns, version breaks); the product is making it digestible. **Utah is the target state and must work.** The code must not hardcode Utah; another state is built by changing one config file.

## 2. Locked decisions (do not relitigate)

1. **No paid anything.** Static site on GitHub Pages from a **public repo (public from the first commit)**, served from `main` branch `/docs`. **No GitHub Actions, no backend, no paid services.**
2. **Preprocessing runs locally**, on the maintainer's machine. **Pipeline language: Python (uv)**, DuckDB-first, SQL in `.sql` files. (Ad hoc profiling or QA in R with base pipe, `sf`, `duckdb` is fine for the maintainer, but R is never a pipeline dependency.)
3. **Source data is real BTS/ORNL/FHWA/Census files.** Do not use third-party repackagings or APIs as the source of record. (The BTS "FAF Data Tabulation Tool" is a web UI; do not scrape it. Use the bulk files.)
4. **Raw files** live locally in `data-raw/` (gitignored). Commit only `data-raw/manifest.json` (source URL, release/version, sha256, bytes, retrieved date). Raw files are large (hundreds of MB national); never commit them.
5. **Processed Parquet and PMTiles are committed** under `docs/data/`. Single canonical location. Every file < 90 MB (Pages limit 100 MB; aim for a few MB each).
6. **Frontend (same stack as NCES):** Vite + TypeScript + Svelte 5, MapLibre GL JS, DuckDB-WASM, Observable Plot, vitest. **Added for this project:** deck.gl (via `@deck.gl/mapbox` `MapboxOverlay`) + **flowmap.gl** for OD flow arcs, and **PMTiles** (`pmtiles` protocol for MapLibre) for the truck network. Self-host DuckDB-WASM binaries/workers via Vite asset imports (no runtime CDNs).
7. **Basemap:** OpenFreeMap (Liberty, Bright, Positron, Dark, Fiord; defaults Positron/Dark), light/dark/system theming, exactly as in the NCES project. Overlays must survive `setStyle`.
8. **Both FAF generations, kept separate.** FAF5.7.1 (2017 benchmark, full series) and FAF6.0 (2022 benchmark, new zones) each have their own zone system, shapes, and tables, shown through an explicit **version switcher** with a persistent "not directly comparable" notice. No crosswalk in v1 (see section 14).
9. **Scope of data per state: flows touching the state.** Keep every OD record where the domestic origin OR domestic destination is a zone in the state (within-zone, between zones inside the state, outbound, inbound, and foreign imports/exports whose entry/exit zone is in the state). The other end can be any US zone or foreign region. Do not ship the full national matrix.
10. **Extras included (all three):** FAF5.7.1 **High/Low forecast scenarios**, **state-level history 1997-2012**, and the **experimental county-level 2022** estimates. These are later phases, but the data model must accommodate them from Phase 1.
11. **Truck network is day-one scope** (FAF5 network flow assignments, 2017 / 2022 / 2050), delivered as **PMTiles**, joined to link flow Parquet in the browser.
12. **Hero view is the OD flow map** (flowmap.gl). The truck network is a toggleable layer of the same map, not a separate page.
13. **Scale target is Utah.** Do not build or test for large states. Colorado (or another state) is an optional smoke test only, never a blocker.

## 3. Known data landscape (as of 2026-10-18)

All items below come from live BTS/ORNL/FHWA pages read on 2026-10-18 unless marked **[VERIFY]**.

### 3.1 Versions and what each contains

| Version | Benchmark | Years | Measures | Zones |
|---|---|---|---|---|
| **FAF6.0** (released 2026-07-31) | 2022 CFS | **2022 only** today | tons (thousand), value (million **2022** $), `current_value` (million current $). **Ton-miles: not in initial release** ("planned for later FAF6 release") | **134 domestic regions**, 8 foreign regions |
| **FAF5.7.1** (released 2025-08-15) | 2017 CFS | 2017 base; **2018-2023 final annual**; **2024 preliminary**; **forecasts 2030-2050** (5-year steps; mid-range, plus High/Low files) | tons (thousand), value (million **2017** $), current value, **ton-miles** (million) | **132 domestic regions**, 8 foreign regions |
| FAF5 reprocessed state history | FAF5 methods | state-level 1997, 2002, 2007, 2012 (and annual per BTS file title; **[VERIFY]** which years are present) | tons, value | 50 states + DC |
| FAF4 and earlier | n/a | on request only (`faf@dot.gov`) | n/a | out of scope |

Version history and numbering rules (`https://www.bts.gov/faf/versions`): a new FAF starts every 5 years in years ending 2 and 7; `FAFa.b.c` where b=1 adds annual Y+1, 2 adds Y+2 and forecasts, 3 adds truck network assignments and ton-miles, 4 adds Y+3, 5 adds Y+4; c is minor/preliminary/correction releases. **BTS stated the 2024 annual estimates and historical base years (1997-2017, state level) will be rebuilt on the FAF6 benchmark in later releases; timing not published. [VERIFY periodically.]** The pipeline must tolerate new FAF6.x releases adding years, scenarios, and ton-miles.

Things to note about FAF5 time series (from the version history): 2024 is **preliminary**; 2022-2023 forecasts were replaced with annual estimates in earlier releases; years 2025-2029 are apparently not published (forecast rows start at 2030) **[VERIFY by profiling]**. Tag every row with `data_version` (`base` | `final` | `preliminary` | `forecast`) from the release notes, not guessed from the year.

### 3.2 Entry points and downloads

| Product | URL (confirmed on a live page 2026-10-18 unless noted) |
|---|---|
| BTS FAF home (FAF6 + links) | `https://www.bts.gov/faf` |
| FAF6.0 regional CSV (20 MB zip) | `https://faf.ornl.gov/faf6/data/Download_Files/ZIP/FAF6.0.zip` |
| FAF6.0 state CSV (7 MB zip) | `https://faf.ornl.gov/faf6/data/Download_Files/ZIP/FAF6.0_State.zip` |
| (Access variants: `FAF6.0_access.zip`, `FAF6.0_State_access.zip`; do not use) | |
| FAF6 zones shapefile (2022 CFS geography) | `https://faf.ornl.gov/faf6/data/FAF6.zip` |
| FAF6 zone-ID to CFS-area lookup | `https://faf.ornl.gov/faf6/data/FAF6%20Zone%20ID%20with%202022%20CFS%20Area%20Code.xlsx` |
| FAF6 metadata (code tables) | `https://faf.ornl.gov/faf6/data/FAF6_Metadata.xlsx` |
| FAF6 user guide | `https://faf.ornl.gov/faf6/data/FAF6%20User%20Guide.pdf` |
| FAF5.7.1 page | `https://faf.ornl.gov/faf5/` (also `https://www.bts.gov/faf/faf5`) |
| FAF5.7.1 regional, mid-range 2017-2024 + 2030-2050 (291 MB zip) | `https://faf.ornl.gov/faf5/Data/Download_Files/FAF5.7.1.zip` |
| FAF5.7.1 regional with High/Low (406 MB zip) | `.../FAF5.7.1_HiLoForecasts.zip` |
| FAF5.7.1 regional 2018-2024 only (184 MB) | `.../FAF5.7.1_2018-2024.zip` |
| FAF5.7.1 state, mid-range (139 MB) | `.../FAF5.7.1_State.zip` |
| FAF5.7.1 state with High/Low (194 MB) | `.../FAF5.7.1_State_HiLoForecasts.zip` |
| FAF5.7.1 state 2018-2024 (87 MB) | `.../FAF5.7.1_State_2018-2024.zip` |
| FAF5.7.1 reprocessed state 1997-2012 (37 MB) | `.../FAF5.7.1_Reprocessed_1997-2012_State.zip` **[VERIFY: the live page's CSV link for this row appears to point at the `_access` file; confirm the CSV file name]** |
| FAF5 zones shapefile (2017 CFS geography) | `https://faf.ornl.gov/faf5/data/2017_CFS_Metro_Areas_with_FAF.zip` |
| FAF5 metadata / lookup | `https://faf.ornl.gov/faf5/data/FAF5_metadata.xlsx`; `.../data/CFS area code - FAF5 zone id.xlsx` |
| FAF5 user guide / base-year method | `.../faf5/data/FAF5 User Guide.pdf`; `.../faf5/data/FAF5_Base_Year_Method_12-2021_FINAL.pdf` |
| **FHWA truck flow assignment** 2017 (529 MB zip) | `https://ops.fhwa.dot.gov/freight/freight_analysis/faf/faf_highway_assignment_results/FAF5_2017_HighwayAssignmentResults_04_07_2022.zip` |
| FHWA truck flow assignment 2022 baseline (530 MB) | `.../FAF5_2022_HighwayAssignmentResults_04_07_2022.zip` |
| FHWA truck flow assignment 2050 baseline (713 MB) | `.../FAF5_2050_HighwayAssignmentResults_09_17_2022.zip` |
| FHWA FAF model highway network (214 MB) | `.../FAF5_Model_Highway_Network.zip` |
| NTAD alternates (ArcGIS Hub/FeatureServer, GeoJSON/Shapefile/GPKG) | "FAF5 Network Links" (487,384 links), "FAF5 Network Nodes" (348,498 nodes), "FAF5 Highway Network Assignments" (tables for 2017, 2022, 2050), "FAF5 Regions"; data dictionaries at DOIs `10.21949/1529027` (links), `10.21949/1528011` (nodes), `10.21949/1529028` (regions), `10.21949/1527987` (assignments) **[VERIFY]** |
| **Experimental county-level (2022, based on FAF5.6.1)** | `https://www.bts.gov/faf/county` (state zips + disaggregation factors; also mirrored on DataLumos) **[VERIFY URLs and file formats]** |
| Zone geography source (Census CFS) | `https://www.census.gov/programs-surveys/cfs/technical-documentation/geographies.html` (2022 shapefile built on TIGER counties; county lists per zone) |
| Citations | FAF6: `https://doi.org/10.21949/fhgm-g335`; FAF5 2017-2050: `https://doi.org/10.21949/1529116`; FAF5 history: `https://doi.org/10.21949/1529108` |

FAF has **no release API and no data JSON**; detection of new releases = probing predictable URL patterns (e.g., `FAF6.1.zip`, `FAF6.1_State.zip`) and reading `https://www.bts.gov/faf/versions`. **[VERIFY the naming pattern when FAF6.1 appears.]**

### 3.3 Dimensions (from the FAF6 User's Guide; FAF5 equivalents **[VERIFY]**)

- **Commodity:** SCTG 2-digit, 42 codes (`01`-`41`, `43`; note there is no 42). Full list in the user guide Table 2 and metadata xlsx. Keep codes as `VARCHAR(2)` with leading zero.
- **Modes (code):** 1 Truck, 2 Rail, 3 Water, 4 Air (incl. truck-air), 5 Multiple Modes and Mail, 6 Pipeline, 7 Other and Unknown, 8 No Domestic Mode (import crude petroleum moved directly ship-to-refinery at the entry zone). **[VERIFY whether FAF5 shares code 8 and wording.]**
- **Trade type:** `1` domestic only, `2` import, `3` export.
- **Fields:** `fr_orig`, `dms_orig`, `dms_dest`, `fr_dest`, `fr_inmode`, `dms_mode`, `fr_outmode`, `sctg2`, `trade_type`, `tons`, `value`, `current_value`, `tmiles` (planned). FAF5 files are believed to use wide per-year columns (e.g., `tons_2017`, `value_2017`, `current_value_2018`, `tmiles_2017`) and possibly a distance-band column; **[VERIFY by reading the actual headers; do not assume.]** FAF6's guide lists un-suffixed field names, so the FAF6 CSV may be wide with `_2022` suffixes or have a `year` column; **[VERIFY.]**
- **Geography:** `dms_orig`/`dms_dest` are FAF zone IDs in the regional database and state codes in the state database **[VERIFY]**. Semantics by trade type (critical, easy to get wrong):
  - Domestic: domestic origin to domestic destination.
  - **Import:** `dms_orig` is the **US zone of entry** (not the foreign origin); `fr_orig` is the foreign origin region; `fr_inmode` is the mode foreign origin to entry; `dms_mode` is entry to destination.
  - **Export:** `dms_dest` is the **US zone of exit**; `fr_dest` is the foreign destination; `fr_outmode` is the mode exit to foreign destination.
  - Foreign regions: 801 Canada, 802 Mexico, 803 Rest of Americas, 804 Europe, 805 Africa, 806 SW and Central Asia, 807 Eastern Asia, 808 SE Asia and Oceania.
- **Zone IDs are 3-digit strings whose first two characters are the state FIPS** (e.g., FAF6 Utah: `491` Salt Lake City-Provo-Orem CFS Area; `499` Remainder of Utah). Zone ID `011` is Alabama. Reading as integer drops the leading zero (`11`): **always read IDs as VARCHAR and zero-pad to 3**. FAF5 Utah zones are believed to also be 491/499 **[VERIFY]**. The state's zones are derived from `fips` in config (zone ID prefix), never hardcoded.
- **FAF5 to FAF6 zone change:** 132 to 134 domestic zones; definitions changed (Census CFS 2022 geography). Treat zone IDs as version-scoped; the same ID may not mean the same area.
- **Standard "views"** (the DTT exposes these; the app must too, defined once in SQL): Total flows (domestic + foreign shipments, domestic leg only, domestic mode), Domestic flows (trade_type 1), Import flows, Export flows. Summing "total" and also adding the foreign legs double counts; the foreign leg is shown separately.
- **Units:** tons = thousand tons; value = million dollars (constant benchmark-year dollars: 2017 for FAF5, 2022 for FAF6; `current_value` is nominal); ton-miles = million. State this in the UI everywhere a number appears.

### 3.4 Network products (FAF5 only; no FAF6 network exists yet)

- **FAF5 model highway network:** 487,384 link features, 348,498 nodes, over 588,000 equivalent road miles; covers the 48 contiguous states, DC, AK, HI; includes NHS, National Highway Freight Network, and connectors. Download from FHWA (214 MB) or NTAD.
- **Truck flow assignment results:** baselines for **2017, 2022, 2050**, by truck type (**Total Truck, Single Unit, Combination Unit**) and market (**domestic, import, export**). Per NTAD: 2017 and 2022 each have 6 data tables; 2050 has 11 **[VERIFY what the tables are and how they join; units: trucks/day vs annual trucks vs tons are NOT confirmed]**. Tables join to the network by link ID **[VERIFY field name]**.
- **Critical caveat to surface in the UI:** the assignment is a **model product from the FAF5.3-era (April 2022) 2017-benchmark flows**; the "2022" scenario is a baseline projection, not FAF6 and not a traffic count. It is not updated for FAF5.7.1 or FAF6. Network flows are not comparable to HPMS/AADT counts; do not imply measured volumes.
- **Link-level flows include through traffic** (trucks passing through the state that neither start nor end there), which the OD flow data cannot show. That is the reason the network layer matters; call it out in the Methodology page.
- Per-link OD or commodity breakdowns, if any, are **[VERIFY]**. FHWA also offers a FAF5 Network Analysis Tool (web); do not scrape it.

### 3.5 Experimental county-level estimates (FAF5-based, 2022)

Based on FAF5.6.1; per-state zips each with four tables: (1) county-to-county OD for the state of interest and every adjacent state, (2) county-to-FAF-zone, (3) FAF-zone-to-county, (4) FAF-zone-to-FAF-zone; plus a national set of origin/destination **disaggregation factors** (FAF code, county FIPS, factor) that can be merged with the regional database to build custom county flows. **[VERIFY all field names, commodity/mode detail, units, and whether values are annual 2022 flows.]** Treat as experimental everywhere in the UI, and never mix with FAF6 numbers.

### 3.6 Known BTS-stated limitations (surface in Methodology; source: `https://www.bts.gov/faf/faqs`)

- FAF is not tailored to a region, may not have granularity for local-scale analysis, local roads are not fully captured, commodity detail may be insufficient for some analyses, and local growth scenarios may differ.
- About 70% of FAF flows by value come directly from the CFS; the rest is modeled from other sources (foreign trade, agriculture, energy, etc.).
- "Within" means intrastate/intra-zone; "from"/"to" summaries exclude within moves.
- FAF5 and FAF6 differ in benchmark year, zone system, and dollar basis.

## 4. Repository layout

```
.
├── HANDOFF.md / CLAUDE.md
├── README.md                      # quickstart, adding a state, updating data
├── config/
│   ├── states/utah.yml            # the ONLY place Utah appears
│   ├── sources.yml                # per version/product: URL patterns, years, formats, probes
│   └── app.yml                    # UI defaults (basemap defaults, palette, mode colors)
├── pipeline/                      # Python (uv), DuckDB-first
│   ├── pyproject.toml
│   ├── faf_pipeline/
│   │   ├── cli.py
│   │   ├── fetch.py               # download + sha256 + manifest + probe-for-new-release
│   │   ├── schemas/               # per product/version column maps (YAML): faf5/ faf6/ network/ county/
│   │   ├── transform/             # DuckDB SQL + thin Python drivers (unpivot, state filter, dims)
│   │   ├── zones.py               # zone shapes (simplified), centroids, lookup, state zone derivation
│   │   ├── network.py             # clip links to state, join flows, build PMTiles inputs
│   │   ├── county.py              # experimental county product
│   │   ├── dictionary.py
│   │   ├── validate.py
│   │   └── update.py              # fetch -> build -> zones -> network -> validate, prints changelog
│   └── tests/                     # pytest with tiny fixture files
├── data-raw/                      # gitignored (except manifest.json)
├── docs/                          # GitHub Pages root (built app + data)
│   ├── index.html, assets/, .nojekyll, SPIKES.md, DECISIONS.md
│   └── data/
│       ├── meta/                  # state.json, versions.json, dictionary.parquet, dims (commodity, mode, zones lookup)
│       ├── faf5/                  # flows/<scenario>/<year>.parquet, state_flows/..., history/...
│       ├── faf6/                  # flows/<scenario>/<year>.parquet, state_flows/...
│       ├── county/                # experimental county-level Parquet
│       ├── network/               # utah_network.pmtiles, link_flows/<year>.parquet, link_attrs.parquet
│       └── geo/                   # faf5_zones.geojson, faf6_zones.geojson, foreign_regions.json, zone_centroids
└── web/                           # app source (Vite + Svelte + TS)
    ├── vite.config.ts             # relative base; outDir ../docs; emptyOutDir false
    └── src/
```

## 5. State configuration contract

`config/states/<name>.yml` (Utah example):

```yaml
name: Utah
abbrev: UT
fips: "49"
bbox: [-114.06, 36.99, -109.04, 42.01]   # [W, S, E, N] [VERIFY]
center: [-111.65, 39.32]
zoom: 6
site_title: "Utah Freight Explorer"
network_buffer_km: 25                     # clip buffer around state for network links [tune in Phase 0]
overrides: {}                             # documented quirks only, kept minimal
```

Rules:
- `--state utah` selects the config; all filtering uses `fips`/`abbrev`. The state's FAF zones are **derived at build** from the zone lookup (zone ID prefix = `fips`), recorded in `docs/data/meta/state.json`, never typed in.
- Adjacent-state county zips (county product) are derived from the config's `abbrev` and the zip contents, not hardcoded.
- **No state literal anywhere in code, SQL, or UI.** Grep for "Utah", "UT", "49", "491", "499" before finishing each phase.
- Adding a state = create a yml, run the pipeline, build. Document in README.

## 6. Data model

Conventions (carry over from NCES project):
- `snake_case`. IDs `VARCHAR` (zone IDs zero-padded to 3; SCTG padded to 2; county FIPS 5; state FIPS 2).
- Wide year columns are **unpivoted to long** (`year` INTEGER) in one SQL step; the column-map guard allows `^(tons|value|current_value|tmiles)_(\d{4})$` patterns so new years arrive without a schema edit, but the changelog lists every newly appeared year. Any other unknown column fails the build.
- Missing/suppressed values: never coerce to 0. Companion flag column where the source distinguishes (`missing`, `not_applicable`, `unknown_other`). **[VERIFY how FAF encodes zero vs absent; likely rows exist only for positive flows.]**
- Every table carries `faf_version` (`5.7.1`, `6.0`, `county-exp`), `benchmark_year` (2017/2022), `data_version` (`base` | `final` | `preliminary` | `forecast`), `scenario` (`mid` | `high` | `low`), and `source_file`.
- **Deterministic Parquet:** explicit `ORDER BY` on keys, ZSTD, fixed row-group size, no timestamps in data. Re-running on unchanged inputs yields byte-identical files.
- Dollar fields: `value_const_musd` (benchmark-year dollars; the dollar year lives in `benchmark_year`) and `value_current_musd`. Never put FAF5 and FAF6 constant dollars in one column without the version column and UI labels.

### 6.1 Tables

| Table | Grain | Notes |
|---|---|---|
| `faf_flows` | version x scenario x year x dms_orig x dms_dest x fr_orig/fr_dest x dms_mode x fr_inmode/fr_outmode x sctg2 x trade_type | tons, value_const, value_current, tmiles (NULL for FAF6 until released). Utah-touching rows only. One file per (version, scenario, year) by default; Phase 0 decides if grouping years is better for file size/latency |
| `faf_state_flows` | same grain at state level | state DB 2017-2024 + forecasts; Utah-touching |
| `faf_state_history` | state x state x year x commodity x mode | 1997-2012 reprocessed; Utah-touching |
| `dim_zone` | version x zone_id | name, state_fips, type (metro / remainder-of-state / whole state), CFS area code, `is_state_zone` (derived), centroid lon/lat |
| `dim_foreign_region`, `dim_commodity`, `dim_mode`, `dim_trade_type` | | labels and descriptions from the metadata xlsx / user guide; harmonize labels across versions once (e.g., SCTG 19 renamed "Natural gas and fossil products" in FAF5.5) |
| `county_flows` (4 sub-tables) | county/FAF-zone OD, 2022 | experimental; state + adjacent states |
| `county_factors` | FAF zone x county | disaggregation factors, filtered to relevant zones |
| `network_links` (PMTiles + `link_attrs.parquet`) | link | geometry in PMTiles; attributes (functional class, NHS/NHFN flags, lanes, length, etc. **[VERIFY from data dictionary]**) in Parquet |
| `network_link_flows` | link x model year (2017/2022/2050) x truck_type x market | volumes as defined by the source **[VERIFY units]**; only links in the clip |
| `dictionary.parquet` | `dataset, table, column, label, description, unit, first_year, last_year, caveat` | Built from FAF metadata xlsx and user guides; core product feature (UI labels, tooltips, caveats) |

### 6.2 Geometry

- **Zones:** one simplified GeoJSON per version (all 132/134 national zones, simplified so each file is roughly 1-3 MB **[measure]**), because the other end of a flow can be anywhere. Properties: `zone_id`, name, state fips, type. Centroids precomputed (for flowmap.gl locations); use `ST_PointOnSurface`-style placement for odd shapes (long, multi-part zones such as Remainder-of-State).
- **Foreign regions** have no geometry. Place the 8 regions as **schematic anchor points** (e.g., just beyond the relevant border/coast) in `foreign_regions.json`, flagged `schematic: true`, and mark them as such on the map and in the legend. Do not imply a real location.
- **Network:** clip FAF5 links to those intersecting the state polygon plus `network_buffer_km`; build one `.pmtiles` per state with tippecanoe (or GDAL MVT + `pmtiles convert` if tippecanoe is unavailable; **[VERIFY the maintainer's OS/toolchain in Phase 0]**). Keep only attributes needed for styling/filter in tiles; flows join client-side by link ID from Parquet in DuckDB-WASM (so a year/truck-type/market switch never rebuilds tiles).
- CRS: store WGS84 (EPSG:4326) for web. **[VERIFY the source CRS and reproject if needed.]**

## 7. Pipeline design

**Tools:** Python via `uv`, DuckDB (Python API + SQL files; spatial extension for geometry), `httpx` for downloads, `pytest`, `ruff`. SQL-first.

**CLI (all take `--state <name>`):**
```
python -m faf_pipeline fetch      [--product faf5|faf6|network|county|history] [--check-only]
python -m faf_pipeline build      [--product ...] [--scaffold-map <product> <version>]
python -m faf_pipeline zones
python -m faf_pipeline network
python -m faf_pipeline validate
python -m faf_pipeline update     # fetch -> build -> zones -> network -> validate, prints changelog
```

**Schema-drift guard:** per product/version YAML column map (source col -> canonical col, type, recode, or `ignore: true` with reason). Any unmapped/missing column fails the build, with nearest-candidate suggestions. `--scaffold-map` copies the previous version's map and marks differences, so FAF6.1 etc. is a quick edit. FAF5 and FAF6 maps are separate files.

**Fetching:** `config/sources.yml` holds URL patterns, expected sizes, and years. `fetch --check-only` probes with HEAD requests and reports; it never downloads silently. Hash and size recorded in the manifest. Large files (FAF5 regional 291-406 MB, network 214-713 MB) are streamed to disk, hashed, and processed with DuckDB reading directly from the extracted CSV (no pandas loads).

**State filter:** build from `dim_zone.is_state_zone`: keep rows where `dms_orig` or `dms_dest` is a state zone (regional DB) or the state FIPS (state DB). Immediately after filtering, assert the kept row count is non-zero and that both inbound and outbound exist.

**Validation (`validate.py`, must pass before commit):**
- Key uniqueness per table-year-scenario.
- All `dms_*`/`fr_*` codes exist in the version's dimension tables; all `sctg2`, mode, trade_type codes known.
- No negative flows; tons/value/tmiles NULL patterns reported.
- **Reconciliation:** within the same release and year, regional DB flows aggregated to state must match the state DB for state-touching rows (report tolerance and exceptions; FAF documents the state DB as the aggregation of the regional DB, **[VERIFY]**).
- Trade-type consistency: imports/exports foreign fields populated, domestic ones null.
- FAF5 vs FAF6 2022: **report-only** comparison of Utah totals (magnitude of benchmark change); never a pass/fail, never merged.
- Year-over-year swing outliers flagged (report only); forecast steps flagged separately from annual estimates.
- Row counts vs previous build; large drops fail.
- Network: every `link_flows.link_id` exists in `network_links`; link coverage of the clip reported; PMTiles opens and contains expected layer; sum of link attributes sane (non-negative lengths).
- Coordinates (zone centroids, links) within state bbox + buffer (national zones exempt from the bbox check).
- Every Parquet/PMTiles file < 90 MB.
- Every output column has a dictionary entry.
- No state literal outside `state.json` (grep).

## 8. Frontend spec

**Stack:** Vite, TypeScript, Svelte 5, MapLibre GL JS, `@deck.gl/mapbox` (`MapboxOverlay`) + `@flowmap.gl/layers` (and `@flowmap.gl/data` as needed), `pmtiles`, `@duckdb/duckdb-wasm`, Observable Plot, vitest.

**Loading strategy:**
1. First paint: basemap + zone polygons (small GeoJSON for the selected version) + a tiny precomputed "headline flows" file (top flows for the default view), so the map is never blank.
2. In the background, start DuckDB-WASM and attach flow Parquet over **HTTP range requests** (same approach proven in the NCES project). Re-verify range/CORS for `.parquet` and `.pmtiles` in Phase 0.
3. Network tiles load on demand from the PMTiles file; link flows load by (year, truck type, market) only when the layer is on.

**Basemap and theme:** identical to NCES (OpenFreeMap five styles, Positron/Dark defaults, System/Light/Dark control, tokens on `:root`, WCAG AA). Basemap switch must not lose overlays: re-add MapLibre sources/layers on `style.load`; confirm the deck.gl overlay and PMTiles layers survive `setStyle` (explicit test).

**Hero view: OD flow map (flowmap.gl):**
- Locations = FAF zones (the selected version's 132/134) plus the 8 schematic foreign regions; flows = aggregated OD pairs for the current filters. Because only state-touching rows ship, every arc has an endpoint in the state (inbound, outbound, or within). Show state zones highlighted.
- Controls: version (FAF5.7.1 / FAF6.0), scenario (mid/high/low where available), year slider (annual estimates and forecast years labeled distinctly; FAF6 shows its single year and an explanatory note about future years), flow view (Total / Domestic / Import / Export), direction (Inbound / Outbound / Both / Within), measure (tons / value / ton-miles; ton-miles disabled with tooltip when unavailable), dollar basis (constant / current), commodity multi-select (42 + grouped presets like "Energy", "Ag and food", "Manufactured"), mode multi-select (8).
- flowmap.gl behaviors to use: width by magnitude, location totals, selection/highlight of a zone to isolate its flows, adaptive scales, optional clustering, optional animation. **[VERIFY current flowmap.gl API/props and deck.gl version compatibility; if it does not work with MapboxOverlay + deck.gl 9 + Svelte 5, document and fall back to deck.gl `ArcLayer`/`LineLayer`.]**
- Top-N slider (default 50 flows) and a minimum-flow threshold, with a visible "showing X of Y flows (Z% of total)" so the filter is honest.
- Mode/commodity coloring is secondary to width; if color encodes mode, use a colorblind-safe palette and never rely on color alone (legend + glyphs/labels).

**Network layer (toggle on the same map):**
- PMTiles line layer from the FAF5 network clip; width and color by link truck volume for the chosen model year (2017 / 2022 baseline / 2050 baseline), truck type (Total / Single Unit / Combination), market (Domestic / Import / Export). Muted greys for zero-flow links. Hover/click: link attributes + volumes by year.
- **Persistent badge** on the layer: "FAF5 model assignment (2017 benchmark); not traffic counts; not updated to FAF6." The network is tied to FAF5; when FAF6 is selected, the layer stays available but labeled with its FAF5 provenance.
- Optional filters: NHFN/NHS, functional class, interstate only (from link attributes **[VERIFY]**).

**Panels and charts (Observable Plot, tokens for theming):**
- KPI strip: total tons, value, ton-miles (if available), value per ton, share by mode, inbound/outbound balance.
- Mode share (stacked bar over years), top commodities (bars), top trade partners (zones + foreign regions), commodity x mode heatmap, trend lines 2017-2050 with scenario band (High/Low) and a **vertical marker at the FAF5 preliminary (2024) and forecast boundary**, and a visible **benchmark-break notice** whenever both versions are on screen. FAF5 and FAF6 series are never drawn as a single connected line.
- Detail panel on click (zone, flow, link): all available fields grouped by topic with dictionary labels and caveats.
- Compare mode: select several zones or commodities and overlay trends (within one version).
- Table view of the current filter with column picker and **CSV export** (export includes version, units, dollar basis, data_version).
- State summary page/panel: within vs inbound vs outbound shares, top partners, top commodities, mode mix (mirrors the BTS "state summary" idea but interactive).
- County (experimental) mode: switch the zone layer to counties for 2022 where the county product has them; clearly stamped EXPERIMENTAL and FAF5.6.1-based.
- **Shareable URL state** (version, scenario, year, view, direction, measure, filters, selection, layers, basemap, theme).
- Responsive (mobile bottom sheet), keyboard accessible, WCAG AA in both themes.
- **Methodology/Data page:** sources and release versions per table/year, preliminary vs final, benchmark change FAF5 to FAF6, zone changes, constant vs current dollars, what "domestic leg of imports/exports" means, SCTG mode "Multiple Modes and Mail", "No Domestic Mode", out-of-scope commodities modeled, network-is-a-model caveat, county experimental caveat, BTS limitations (section 3.6), citations/DOIs, links to originals. Footer credits: BTS, FHWA, ORNL, Census CFS, OpenFreeMap/OSM.

**Must not:** rank places, compute "performance" scores, forecast beyond published scenarios, present modeled flows or link volumes as measured counts, or imply local-scale accuracy. Show data and caveats only.

## 9. Deployment (no Actions)

- GitHub Pages from `main` `/docs`; `npm run build` in `web/` writes to `docs/` with `emptyOutDir: false`; `docs/.nojekyll`.
- Relative Vite `base` (or `/<repo>/`); verify asset, data, and PMTiles paths under the project URL.
- No Git LFS. Keep repo well under ~1 GB. Deterministic outputs keep diffs small. `.pmtiles` and Parquet files each < 90 MB; commit them only after `validate` passes.

## 10. DuckDB skills (development aid)

Same as the NCES project: `/plugin install duckdb-skills@claude-plugins-official` (requires DuckDB CLI). Use `read-file` to profile each raw file (real headers/types/sentinels), `convert-file` for prototypes, `spatial` for zone/link work, `duckdb-docs` for syntax. **Always inspect an actual raw file before writing or changing a column map.** Dev tool only.

## 11. Phased plan with acceptance criteria

**Phase 0: Spikes (public repo; Pages enabled for range-request tests)**
- Download and profile one real file each: FAF6.0 regional + state CSV, FAF5.7.1 regional + state CSV (the 291 MB / 139 MB mid-range files), the FAF5.7.1 State reprocessed 1997-2012 CSV, both zone shapefiles, both metadata xlsx files, one FHWA truck-assignment zip (2017) + the model network zip, one county-level state zip (Utah). Record real URLs, formats, encodings, **headers, ID formats (zero padding), year-column patterns, how zeros/missing appear, units**, link-ID join field, assignment table list and meaning, CRS.
- Measure realistic Utah-touching Parquet size for each version/scenario/year and extrapolate to all years (including Hi/Lo and state history); decide file partitioning.
- Network: clip to the state with a candidate buffer; count links; build a PMTiles; measure size; test MapLibre + `pmtiles` rendering and style-by-feature-state or join-by-ID approach with Parquet-driven volumes.
- Confirm Pages serves `.parquet` and `.pmtiles` with range requests (206) and CORS (re-verify; the NCES result was positive for Parquet).
- flowmap.gl spike: MapLibre + `MapboxOverlay` + deck.gl + flowmap.gl in a Svelte 5 page with ~200 sample flows; confirm overlay survives `setStyle`; record versions that work.
- Check tippecanoe/`pmtiles` availability on the maintainer's OS; pick the tool path.
- Cross-check: FAF5 vs FAF6 Utah 2022 totals; regional vs state DB reconciliation for one year.
- **Output:** `docs/SPIKES.md` with findings and corrections to this document. **Stop and show findings before Phase 1.**

**Phase 1: Pipeline foundation + OD flows + zones + network data**
- Config loader, fetch+manifest, schema guard, dictionary builder, deterministic Parquet writer, zone derivation.
- FAF5.7.1 (mid-range, regional + state) and FAF6.0 flows, all years, state-touching; dims; zone GeoJSON and centroids; network clip, link attributes, link flows (2017/2022/2050), PMTiles; validation passing.
- Tests on tiny fixtures. **Accept:** `update --state utah` is idempotent (second run produces no git diff); Utah's FAF5 and FAF6 zones are derived, not typed.

**Phase 2: App shell + hero flow map + network layer**
- Svelte app, theme, basemap switcher, version switcher, zone polygons, flowmap.gl OD layer with core filters (view, direction, measure, year, commodity, mode), network PMTiles layer with year/truck-type/market, detail panel, URL state, KPI strip.
- **Accept:** works in light/dark; basemap switch keeps both overlays; Pages deployment works from `/docs`; network and flow layers render together without blocking first paint.

**Phase 3: Charts, forecasts, scenarios**
- Trend/mode/commodity/partner charts, forecast boundary and preliminary markers, High/Low scenario ingestion and UI, FAF6 "single year" handling, benchmark-break notices, compare mode, table + CSV export.

**Phase 4: Extras**
- State history 1997-2012 view (state-level only, labeled "historical state-level series, FAF5 reprocessed").
- Experimental county-level 2022 mode (state + adjacent states) with factors; EXPERIMENTAL stamps.

**Phase 5: Polish & open-source readiness**
- Methodology page, README (quickstart, adding a state, updating after a new FAF release incl. what to do when FAF6 annual years or ton-miles appear), CONTRIBUTING, LICENSE (code MIT or Apache-2.0, maintainer's choice; data is U.S. public data, add attribution), accessibility and performance passes, issue templates. Optional single smoke run for another state; document results without promising support.

## 12. Working agreements for Claude Code

1. **Verify before trusting.** Anything marked [VERIFY] must be confirmed against the live source. Never invent column names, URLs, units, or release dates; if something can't be reached, say so and ask.
2. **Look at real data first.** Profile each raw file with DuckDB before writing its schema map.
3. **Ask before changing spending decisions.** No paid services, Actions, external CDNs for runtime code, or backends; if you think one is warranted, explain and ask.
4. **No hardcoded state.** Run the grep check each phase.
5. **Small, reviewable commits** per phase; commit processed outputs only after `validate` passes. Do not commit raw files.
6. **Record decisions and deviations** in `docs/DECISIONS.md` (date, decision, why).
7. **Report assumptions** at the end of each phase, plus a list of anything unverified.
8. **Keep the UI data-honest:** surface dictionary caveats; label version, units, dollar basis, data_version, and model-vs-measured everywhere; no rankings, no quality scores.
9. Prefer boring, well-supported libraries; pin versions that the Phase 0 spike proved compatible (deck.gl, flowmap.gl, MapLibre, pmtiles).

## 13. Open questions to resolve during Phase 0

- Exact FAF5 and FAF6 CSV headers: wide vs long years, distance-band column, `tmiles` presence, row counts, how zeros and missing are represented.
- Do FAF6 files include a `year` field or `_2022` suffixes? What will FAF6.1+ do to the schema?
- Network assignment tables: which 6 (2017/2022) and 11 (2050) tables, join key, units, and whether link volumes carry commodity/OD detail.
- County-level product: file formats, adjacent-state coverage for Utah, units, commodity/mode granularity, and whether factors are annual.
- Utah FAF5 zone IDs and names; Utah-touching row counts per year; regional vs state DB reconciliation tolerance.
- Which FAF5 years exist as forecasts (2030-2050 steps; confirm no 2025-2029), and the exact semantics of the preliminary 2024 rows.
- flowmap.gl compatibility with current deck.gl/MapLibre/Svelte 5; performance with Utah-sized flow sets.
- tippecanoe availability on the maintainer's machine; PMTiles size for the chosen buffer and attribute set.
- Whether PMTiles + Parquet range requests behave on Pages (expected yes).

## 14. Deferred / explicitly out of scope for v1

- **FAF5-to-FAF6 zone crosswalk / harmonized trend line** (would require county-based allocation and heavy caveats). Revisit when BTS releases FAF6 annual estimates and rebenchmarked history; keep the data model ready (`benchmark_year`, `faf_version`).
- Supplementary datasets (HPMS AADT, NHFN designations from other sources, rail/waterway networks, ports, CFS microdata). FAF only.
- Multimodal network assignment (BTS webinar mentions rail/water assignment in progress); add if and when released.
- Rankings, scoring, route planning, or any prediction beyond published FAF scenarios.

---

## First session prompt (paste this to Claude Code)

> Read HANDOFF.md fully. Do not write app code yet. Start with Phase 0 (spikes): set up the project skeleton (uv, Vite+Svelte+TS), install the duckdb-skills plugin if available, create `config/states/utah.yml`, then download and profile one real file each for FAF6.0 (regional + state), FAF5.7.1 (regional + state mid-range), both zone shapefiles, the FAF5 reprocessed 1997-2012 state file, one FHWA 2017 truck-assignment zip plus the model highway network, and one county-level state zip for the state in the config. Profile everything with DuckDB. Run the Pages range-request test (Parquet and PMTiles), the OpenFreeMap style test, and a flowmap.gl + MapboxOverlay + Svelte 5 spike. Measure Utah-touching Parquet sizes and PMTiles size for the network clip. Then write `docs/SPIKES.md` with real URLs, headers/schemas, ID formats, units, sentinel behavior, sizes, tool availability, and any corrections to HANDOFF.md. Stop and show me the findings before starting Phase 1.
