# Phase 0 spike findings

Run 2026-10-18 on the maintainer's Windows 11 machine. Everything below was measured from the real downloaded files unless marked **UNVERIFIED**. Raw files are in `data-raw/` (gitignored); URLs, sizes, and sha256 are in `data-raw/manifest.json`. Scratch SQL/scripts were not committed.

## 0. Summary: what to know before Phase 1

1. **HANDOFF corrections that change design** (details in section 12): FAF6.0 CSV has **no `current_value` and no `tmiles`**; FAF5 forecast years have no `current_value`; FAF5 zero-valued rows are explicit (must be dropped when unpivoting); state-history has 4 years only (1997/2002/2007/2012); county product is **tons only** and uses a different mode code set.
2. **GitHub Pages does NOT serve Parquet by byte range to DuckDB-WASM.** DuckDB-WASM downloaded each Parquet with one plain GET (200, `Content-Encoding: gzip`). PMTiles range requests work (206). So Parquet must be partitioned into small files. Total Utah data is small enough that this is fine (section 7).
3. **No tippecanoe needed.** DuckDB's spatial extension (GDAL) writes PMTiles directly. 2.4 MB for the whole Utah+25 km network.
4. **flowmap.gl 9.4.0 + deck.gl 9.4.0 + MapLibre 6.15.0 + Svelte 5.57 works**, and the overlay plus PMTiles layer survive `setStyle`. Several setup gotchas (section 9).
5. Regional-to-state **reconciliation is exact** for both FAF5.7.1 and FAF6.0 (zero mismatching rows).
6. FAF5.7.1 vs FAF6.0 Utah 2022 differ **a lot** (+52% domestic tons). Report-only, as planned.
7. Open items needing you: section 13.

## 1. Tool availability (maintainer machine)

| Tool | Status |
|---|---|
| uv 0.10.8 | present; Python pinned 3.14 (`pipeline/.python-version`) |
| DuckDB CLI | present (WinGet); `spatial` and `excel` extensions install on demand |
| Node 26.8.1 / npm 11.19 | present |
| Docker, WSL | present (not used) |
| tippecanoe, `pmtiles` CLI, GDAL/ogr2ogr | **absent** |
| duckdb-skills plugin | not installed (it is a user-level `/plugin install`); I used the DuckDB CLI directly |

**Tool path chosen for PMTiles:** `COPY (...) TO 'x.pmtiles' WITH (FORMAT GDAL, DRIVER 'PMTiles', DATASET_CREATION_OPTIONS ('MINZOOM=3','MAXZOOM=12'), LAYER_CREATION_OPTIONS ('NAME=faf5_links'))` from the DuckDB spatial extension. Gotcha: `MINZOOM`/`MAXZOOM` given as *layer* options are silently ignored (archive came out z0-5); they must be *dataset* options. Limitation vs tippecanoe: no feature dropping/simplification per zoom (every link appears at every zoom). Irrelevant at 2.4 MB. Set `geometry_always_xy = true` when transforming; verified output is lon,lat.

## 2. Raw files fetched (all live, HTTP 200, 2026-10-18)

| Product | URL | Bytes |
|---|---|---|
| FAF6.0 regional | `https://faf.ornl.gov/faf6/data/Download_Files/ZIP/FAF6.0.zip` | 20,861,180 |
| FAF6.0 state | `.../ZIP/FAF6.0_State.zip` | 6,823,123 |
| FAF5.7.1 regional (mid) | `https://faf.ornl.gov/faf5/Data/Download_Files/FAF5.7.1.zip` | 305,397,783 |
| FAF5.7.1 state (mid) | `.../FAF5.7.1_State.zip` | 145,261,207 |
| FAF5.7.1 state Hi/Lo | `.../FAF5.7.1_State_HiLoForecasts.zip` | (downloaded; regional Hi/Lo not) |
| State history 1997-2012 | `.../FAF5.7.1_Reprocessed_1997-2012_State.zip` | 38,901,646 |
| FAF6 zones shp | `https://faf.ornl.gov/faf6/data/FAF6.zip` | 17,002,654 |
| FAF5 zones shp | `https://faf.ornl.gov/faf5/data/2017_CFS_Metro_Areas_with_FAF.zip` | 19,027,752 |
| FAF5/FAF6 metadata, FAF6 zone-CFS lookup | `.../faf5/data/FAF5_metadata.xlsx`, `.../faf6/data/FAF6_Metadata.xlsx`, `.../faf6/data/FAF6%20Zone%20ID%20with%202022%20CFS%20Area%20Code.xlsx` | ~20-29 KB each |
| FHWA 2017 truck assignment | `https://ops.fhwa.dot.gov/freight/freight_analysis/faf/faf_highway_assignment_results/FAF5_2017_HighwayAssignmentResults_04_07_2022.zip` | 554,411,230 |
| FHWA model network | `.../FAF5_Model_Highway_Network.zip` | 224,725,381 |
| County, Utah | `https://faf.ornl.gov/faf5/Data/County/49%20-%20Utah.zip` (see section 10) | 116,725,849 |
| County factors | `https://faf.ornl.gov/faf5/Data/County/All_Experimental_Disaggregation_Factors.zip` | 570,159 |

2022 and 2050 assignment zips were only listed remotely (central directory), plus the 2050 zip's network GDB and Total-Truck table were extracted for comparison.

## 3. FAF flow files (profiled with DuckDB, everything read as VARCHAR first)

All CSVs: ASCII, comma, header row, UTF-8-safe, no quoting issues. Empty string = not applicable (DuckDB reads as NULL).

### FAF6.0 regional (`FAF6.0.csv`, 1,921,887 rows)
Columns: `fr_orig, dms_orig, dms_dest, fr_dest, fr_inmode, dms_mode, fr_outmode, sctg2, trade_type, tons_2022, value_2022`.
- **Wide with `_2022` suffix.** No `year` column, **no `current_value`, no `tmiles`, no `dist_band`.**
- 134 distinct origin and destination zones; zone IDs are 3-char strings with leading zeros ("011"). Auto-typing makes `fr_*`, modes, trade_type ints but `dms_*`/`sctg2` stay strings; read all as VARCHAR.
- trade_type 1/2/3 = 676,839 / 649,543 / 595,505 rows. Foreign fields populated exactly as HANDOFF section 3.3 says (imports: `fr_orig`+`fr_inmode`; exports: `fr_dest`+`fr_outmode`; domestic: none). Foreign codes 801-808 all present.
- Modes 1-8 present (mode 8 only 77 rows). SCTG: 42 distinct codes, `01`-`43`.
- No duplicate keys. No negatives, no empty values. 356 rows have `value_2022 = 0` (tons > 0). No zero tons.
- Utah zones, by prefix of the config FIPS: `491`, `499`. Utah-touching rows: **36,765**.

### FAF6.0 state (`FAF6.0_State.csv`, 599,529 rows)
Same columns but `dms_origst`, `dms_destst` (2-char state FIPS). Utah-touching: 14,888 rows.

### FAF5.7.1 regional (`FAF5.7.1.csv`, 1.18 GB, 2,671,386 rows)
Header (53+ columns): key fields as FAF6 **plus `dist_band`** (8 bands, metadata sheet "Distance Band"), then wide year columns:
- `tons_YYYY`, `value_YYYY`, `tmiles_YYYY` for **2017, 2018-2024, 2030, 2035, 2040, 2045, 2050** (13 years). **No 2025-2029** (confirmed).
- `current_value_YYYY` for **2018-2024 only** (not 2017, not forecasts).
- No NULLs/empties in any measure column.
- 132 zones; Utah zones `491`, `499` (same IDs as FAF6; names "Salt Lake City UT", "Rest of UT" in both versions' metadata). Utah-touching rows: **45,109** (wide).
- **Zeros are explicit.** E.g. 1,028,517 of 2,671,386 rows have `tons_2017 = 0`; 968,596 have `tons_2022 = 0`. A row exists if any year is positive. Unpivoting must drop all-measure-zero (year, key) rows. Utah long (13 years x 45,109 wide rows): 586,417 rows, of which 380,514 have any measure > 0 (about 29k per year). Do not coerce zero to NULL; just do not emit empty rows. Edge cases: 24 rows tons>0/value=0, 139 value>0/tons=0, 253 tons>0/tmiles=0, so use "any measure > 0" as the keep rule.
- `data_version` is not in the files. Tagging must come from the release notes (section 11).

### FAF5.7.1 state (`FAF5.7.1_State.csv`, 1,198,666 rows)
Same wide columns, with `dms_origst`/`dms_destst`, includes `dist_band`. 51 origin "states" (50 + DC). Utah-touching: 25,453 rows.

### FAF5.7.1 state Hi/Lo (`..._State_HiLoForecasts.csv`, 1,198,666 rows)
Only forecast years 2030-2050. Columns: mid `tons_/value_/tmiles_YYYY`, plus `tons_YYYY_low`, `tons_YYYY_high`, `value_YYYY_low`, `value_YYYY_high`. **No tmiles low/high.** No empties. Utah-touching 25,453 rows. The regional Hi/Lo file (406 MB) was **not** downloaded; I assume the same pattern (**UNVERIFIED**).

### Reprocessed state history (`FAF5.7.1_Reprocessed_1997-2012_State.csv`, 184 MB, 1,110,128 rows)
- The URL in HANDOFF is correct and is the CSV (not Access).
- Columns: `fr_orig, dms_origst, dms_destst, fr_dest, fr_inmode, dms_mode, fr_outmode, sctg2, trade_type`, then **`tons_`, `value_`, `current_value_`, `tmiles_` for 1997, 2002, 2007, 2012 only (not annual)**. No `dist_band`.
- 51 states (01-56 with gaps), 42 SCTG, trade types 1/2/3. Utah-touching: 24,859 rows.
- Zeros explicit: 492,436 rows have `tons_1997 = 0`; 109,144 rows are zero in all four years (drop).
- Utah domestic-touching tons (thousand tons): 1997 168,043; 2002 186,475; 2007 234,426; 2012 179,693.

### Units (from metadata and the FHWA dictionary)
tons = thousand tons; value = million dollars (constant benchmark-year dollars). **FAF5: 2017 dollars, verified in Phase 4 against the FAF5 User Guide** (`value` = "Total value (in 2017 dollar) ... Million $"; `current_value` = "in current dollar of each year"); the FAF6 2022-dollar basis is still taken from HANDOFF (**UNVERIFIED**); tmiles = million. The same guide says the historical years 1997, 2002, 2007 and 2012 are provided "at only state level", built with FAF5 methodology. FHWA assignment tables: tons = annual thousand tons, trips = daily truck trips (read from the assignment data dictionary).

### Metadata workbooks
Sheets (identical structure in both): `Data Dictionary` (only a title string found in the cell I read), `State`, `FAF Zone (Domestic)` (cols `Numeric Label`, `Short Description`, `Long Description`), `FAF Zone (Foreign)`, `Commodity (SCTG2)`, `Mode`, `Trade Type`, `Distance Band`.
- **Commodity labels are identical** across FAF5.7.1 and FAF6.0 metadata (0 differences across 42). The "SCTG 19 renamed in FAF5.5" concern does not show up between these two files.
- Mode labels differ only for code 1 ("Truck" vs "Truck (include customer pick-up)"). Code 8 "No domestic mode" present in both and in the data.
- Zones: FAF5 132 vs FAF6 134. Only in FAF5: `190`. Only in FAF6: `191`, `199`, `395`. 6 IDs shared by both have different short names. So IDs are version-scoped, as HANDOFF warned.

## 4. Cross-checks

**Regional vs state DB (Utah-touching, 2022):** regional rows aggregated to state (key incl. `dist_band` for FAF5) vs the state file: **FAF5.7.1: 25,453 rows both sides, 0 mismatches (tons, checked at 1e-6); FAF6.0: 14,888 rows, 0 mismatches (tons and value)**. Aggregate tons/value/tmiles equal to 3 decimals. This resolves the [VERIFY]; the state DB is exactly the aggregation of the regional DB, so tolerance can be 1e-6 and the check can be strict.

**FAF5.7.1 vs FAF6.0, Utah-touching, 2022 (report only):**

| | FAF5.7.1 | FAF6.0 |
|---|---|---|
| domestic tons (kt) | 217,325 | 329,980 |
| domestic value (M$, benchmark $) | 218,998 (2017$) | 410,679 (2022$) |
| import tons / value | 3,168 / 14,726 | 3,255 / 18,481 |
| export tons / value | 3,347 / 12,922 | 3,500 / 16,772 |

National domestic tons are nearly equal (17.41 B kt vs 17.29 B kt) but national domestic value is 14.78 T vs 19.58 T. So the Utah tonnage jump is not a general rescale; zone redefinition/2022 CFS benchmark are plausible causes, **cause UNVERIFIED**. The UI notice must say the two versions are not comparable.

## 5. Zone geography

| | FAF6 | FAF5 |
|---|---|---|
| file | `FAF6.shp` | `2017_CFS_Metro_Areas_with_FAF.shp` |
| features | 134 | 132 |
| zone id field | `FAF6` (3-char string) | `FAF_Zone` (3-char string) |
| name fields | `FAF6_SHORT`, `FAF6_NAME`, `CFS22_NAME`, `CFS22_ID` | `FAF_Zone_D` (short), `CFS17_NAME`, `GEOID`, `INTPTLAT/INTPTLON` |
| CRS | NAD83 geographic (EPSG:4269) | NAD83 geographic (EPSG:4269) |
| geometry | 1,634,078 vertices, all valid | 1,770,973 vertices, all valid |

- IDs are strings with the leading zero, 1 feature per zone. Both versions: Utah = `491` (POLYGON), `499` (MULTIPOLYGON).
- **Simplified GeoJSON size** (DuckDB `ST_Simplify`, 4 decimals): tolerance 0.01 deg = **0.41 MB** per version; 0.003 deg = 1.0 MB. Much smaller than the 1-3 MB estimate; use ~0.005 deg and re-check visually in Phase 2.
- **Bbox check (resolves the [VERIFY] in `utah.yml`):** union of the state's zones = `[-114.053, 36.998, -109.041, 42.002]` (both versions agree to 0.001); config bbox is a slightly padded superset. Kept.
- **Centroid caveat (design issue for Phase 1):** `ST_PointOnSurface` of Utah's `491` zone lands at (-112.47, 40.66), in the Tooele County desert west of Salt Lake City, not in the urban core; flow arcs visibly originate there in the spike. `ST_Centroid` is no better for the multi-part remainder zone `499`. Options: use the FAF5 shapefile's `INTPTLAT/INTPTLON` where present, or a population/county-weighted point (needs a county layer). Needs a decision, see DECISIONS.md.
- FAF6 lookup xlsx (zone to 2022 CFS area code) fetched; not yet parsed.

## 6. Network (FAF5 only)

- **Network GDB** (`FAF5Network.gdb`) opens directly in DuckDB spatial (`st_read`, GDAL OpenFileGDB); no ArcGIS/GDAL CLI needed. **487,394 links** (HANDOFF said 487,384), all `MULTILINESTRING`, EPSG:4269, `ID` (INTEGER) unique (1 to 1,949,504). Single link layer read by default.
- Attributes: `ID, LENGTH, DIR, DATA, VERSION, Class, Class_Description, Road_Name, Sign_Rte, Rte_Type, Rte_Number, Rte_Qualifier, Country, STATE, STFIPS, County_Name, CTFIPS, Urban_Code, FAFZONE (INTEGER: pad to 3), Status, F_Class, Facility_Type, NHS, STRAHNET, NHFN, Truck, AB_Lanes, BA_Lanes, Speed_Limit, Toll_*, HPMS_*, Border*, speed/time fields, SHAPE_Length`. Code lists for `F_Class`, `NHS`, `STRAHNET`, `NHFN`, `Truck`, `Status` are in `FAF5 Network Data Dictionary.pdf` inside the zip. `STATE` includes Canadian provinces (`Country` = CAN, 1,758 links).
- Link `Class` 50 = **Centroid Connector** (virtual zone-access links). The highest 2017 truck volume among Utah-area links is a centroid connector (4,700 trips/day). **UI must exclude or flag Class 50 and Class 21/22 ramps carefully**; not decided yet.
- **Assignment tables:** the 2017 zip holds **6 CSV tables** (Domestic, Export, Import, Total CU, Total SU, Total Truck) plus a TransCAD copy and the data dictionary. 2022 zip: same 6 (`_2022`). 2050 zip: same 6 (`_2050Base`) **and its own copy of the network**. HANDOFF's "11 tables for 2050" does not match the FHWA zip (**cause UNVERIFIED**; maybe NTAD counts differently). The data dictionary text also mentions a 2030 baseline; no 2030 file is in these zips.
- Join key: CSV `ID` to GDB `ID`. Columns per table: `AB|BA|TOT` x `Tons|Trips` for all commodities, then the same 6 for each of **12 commodity groups** (e.g. "Farm Products", "Food, Bev and Tobacco"; SCTG membership in the dictionary). 79 columns in the 2017 Total table. **Units: Tons = annual thousand tons; Trips = daily truck trips** (from the dictionary).
- Coverage: the 2017 Total table has 316,070 rows (of 487,394 links). 0 flow IDs missing from the network; 171,324 links have no flow row (treat as zero flow, never invent). 
- **2050 network == 2017 network** for our purposes: identical ID set, identical `LENGTH`, `F_Class`, `AB_Lanes` for every link (0 differences). One link geometry file serves 2017/2022/2050.
- **Clip (Utah polygon = union of the FAF6 zones with the config FIPS prefix, buffered in EPSG:5070):** 0 km: 3,957 links; **25 km: 4,244**; 100 km: 5,651. Links with `STFIPS = 49`: 3,939. Of the 4,244, 2,615 have a 2017 Total-Truck flow row (all with tons > 0).
- **PMTiles:** zoom 3-12, layer `faf5_links` (props `id, cls, fc, nhs, nhfn, strahnet, dir`), 4,244 features, **2.44 MB** (header: version 3, tile type MVT, gzip-compressed tiles). Opens with `pmtiles` 4.5.0; renders in MapLibre 6.15.
- **Join approach tested and working:** `promoteId: 'id'`, then `map.setFeatureState({source, sourceLayer, id}, {trips})` from rows loaded with DuckDB-WASM, and a `feature-state` expression styles width/color. In the browser, 1,332 of 2,592 rendered features had flow state after load (rest = no flow row), and the state survived `setStyle` after re-applying on `style.load`.
- Parquet sizes: Utah-clip link attributes 0.05 MB; link flows (2017 Total table, 7 columns, 2,615 rows) 0.04 MB. A full long-form (3 years x 6 tables x 12 groups) is estimated at a few MB (**not measured**).

## 7. Utah-touching Parquet sizes (ZSTD, sorted, DuckDB default row groups; measured)

| Dataset | Rows | Size |
|---|---|---|
| FAF5.7.1 regional, all 13 years, long, mid-range | 380,514 | 7.09 MB (one year: 0.65 MB) |
| FAF5.7.1 state, 2022 only | 25,453 | 0.41 MB |
| FAF5.7.1 state Hi/Lo (wide, state level, Utah-touching) | 25,453 | 4.66 MB |
| FAF6.0 regional, 2022 (wide) | 36,765 | 0.30 MB |
| State history 1997-2012 (wide, Utah-touching) | 24,859 | 0.76 MB |
| County: county-to-county (Utah-touching) | 208,110 | 0.54 MB |
| County: county-to-FAF / FAF-to-county (state only) | 522,727 / 501,240 | 1.58 / 1.37 MB |
| Network link attributes (clip) | 4,244 | 0.05 MB |

Extrapolation (everything for Utah, incl. FAF5 regional Hi/Lo ~+5 MB, state DB all years ~+4 MB, network flows ~+3 MB): **well under ~40 MB** total committed data, every file far below 90 MB. **Partitioning:** because Parquet is fetched whole on Pages (section 8), partition by `(version, scenario, year)` as in HANDOFF (about 0.3-0.7 MB each), plus maybe one "all years, one measure" file for trends. A single 7 MB all-years file also loads fine (query incl. download 392 ms locally from Pages).

## 8. GitHub Pages behavior (live, `https://ar-puuk.github.io/freight-explorer/`)

I enabled Pages (`main`, `/docs`) via `gh api`; the spike page and `docs/data/_spike/` are live. Tested with headless Chromium.
- `.pmtiles`: browser GETs with `Range` return **206**, `Content-Range` uses the identity size (2,444,682), `Access-Control-Allow-Origin: *`, `Accept-Ranges: bytes`. Tiles rendered. **Works.**
- `.parquet` through DuckDB-WASM 1.33.1-dev57 (`registerFileURL` HTTP protocol): **one full GET, status 200, no `Range` header, `Content-Encoding: gzip` (one request got `zstd`)**, for both a 0.68 MB and a 7.4 MB file. The NCES-project positive range result did **not** reproduce here; I did not dig into DuckDB-WASM's reason (likely it falls back to full reads when the response is content-encoded).
- Pages compresses on the fly. A manual `curl -r 0-99` with `Accept-Encoding: gzip` returned `206`, `Content-Encoding: gzip`, `Content-Range: bytes 0-99/680380` (compressed length) versus the real 681,963-byte file. A ranged request that advertises gzip therefore reads a slice of the gzip stream, not of the file. Browsers asking for ranges (PMTiles) behaved correctly, but any client combining `Range` with `Accept-Encoding` on Pages is unsafe. Do not rely on Parquet range reads on Pages.
- `Cache-Control: max-age=600`. Content type for both is `application/octet-stream`.

## 9. Frontend spike (`web/`, built into `docs/spike.html`)

Working combination, installed from npm on 2026-10-18 (see `web/package.json`/lock): Vite 8.3.4, Svelte 5.57.2, @sveltejs/vite-plugin-svelte 7.3.1, **TypeScript 6.0.3**, maplibre-gl **6.15.0**, @deck.gl/core, layers, mapbox **9.4.0**, @flowmap.gl/layers and data **9.4.0**, pmtiles **4.5.0**, @duckdb/duckdb-wasm **1.33.1-dev57.0**, @observablehq/plot 0.6.17, vitest 5.0.5, svelte-check 4.7.7.

Test: 200 real flows (top Utah-touching FAF6 2022 domestic OD pairs, tons), 134 zone points, PMTiles network colored by DuckDB-WASM-loaded link flows, five OpenFreeMap styles.
- OpenFreeMap styles `liberty, bright, positron, dark, fiord` all return HTTP 200 (`https://tiles.openfreemap.org/styles/<name>`).
- `MapboxOverlay({interleaved: false})` with `FlowmapLayer` on MapLibre 6.15: arcs, location circles and arrowheads render in light and dark.
- **`setStyle` survival:** switching positron to dark to liberty keeps the deck.gl layer (non-interleaved overlay has its own canvas; layer list unchanged) and, after re-adding the PMTiles source/layer and re-applying feature states in a `style.load` handler, the network renders again each time (2,592 features, 1,332 with flow state, unchanged across switches). Overlay and basemap redraw confirmed in screenshots (positron, dark, liberty).
- Gotchas found: (1) maplibre-gl 6 has no default export: `import * as maplibregl`. (2) MapLibre 6's worker is not emitted by Vite automatically; needs `import w from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'` and `maplibregl.setWorkerUrl(w)`. Without it the map silently shows no basemap or vector tiles. (3) `typescript@7.0.2` conflicts with `svelte-check@4.7.7` (peer `^5 || ^6`); pinned TS 6. (4) `@duckdb/duckdb-wasm` types require an `mvp` bundle; I ship only the EH bundle (36 MB) and cast. The MVP wasm is another 41 MB. (5) The build emits a ~2.1 MB JS bundle (no code-splitting yet).
- **Unresolved:** one early run showed a deck/luma overlay "Compilation error in fragment shader 'flowmap-circles-fragment-cached'" in three consecutive screenshots. It did not reproduce in the following ~6 runs, local or on Pages. The environment was headless Chromium with SwiftShader (software GL). Needs one look on a real GPU in your browser (open the Pages URL below).
- Not tested: Firefox/Safari, mobile, clustering/animation, `interleaved: true`, hover/click picking, 50k+ flows.
- Page: `https://ar-puuk.github.io/freight-explorer/spike.html` (buttons switch the basemap; log at bottom-left).

## 10. County-level experimental product

- `https://www.bts.gov/faf/county` and the DataLumos mirror return **HTTP 403** to scripted requests (also the technical report PDF). I found the real file URLs in a Wayback Machine snapshot of the BTS county page (2026-05-08): files are hosted at `https://faf.ornl.gov/faf5/Data/County/<NN> - <State name>.zip` (NN = state FIPS) and `All_Experimental_Disaggregation_Factors.zip`. The pipeline can build the name from the config's `fips` plus the state's name; **the FIPS-name pairing is not typed anywhere in code**, but the name comes from `state.yml` `name`.
- Utah zip: 4 CSVs, stored uncompressed (zip = 116.7 MB, inner 47 + 24 + 23 + 23 MB): `1.County-to-County.csv` (928,919 rows), `2.County-to-FAF.csv` (522,727), `2.FAF-to-County.csv` (501,240), `3.FAF-to-FAF.csv` (574,047).
- Columns: `trade_type, fr_orig, fr_inmode, fr_dest, fr_outmode, dms_orig, dms_orig_cnty, dms_dest, dms_dest_cnty, sctgG5, dms_mode, tons_2022`. **Tons only (no value, no tmiles), year 2022, 5 commodity groups** (`sctg0109, sctg1014, sctg1519, sctg2033, sctg3499`), **modes `2, 5, 6, 11`** in county-to-county and `2, 3, 5, 6, 11` in FAF-to-FAF. Mode code 11 is not in the FAF 1-8 list and dominates tonnage. **Resolved 2026-10-18 from the BTS technical report (now in `data-raw/county/`, Table 13): `11` = Truck and air (FAF modes 1 + 4); `2` rail, `3` water, `5` multiple modes, `6` pipeline; FAF modes 7 and 8 are excluded from the release files.** Table 12 defines the groups: `sctg0109` agricultural products (SCTG 01-09), `sctg1014` gravel and mining (10-14), `sctg1519` coal and other energy (15-19), `sctg2033` chemical, wood and metals (20-33), `sctg3499` manufactured goods, mixed freight, waste, unknown (34-99). County FIPS are 5-char and zone IDs 3-char in the data tables.
- County-to-county covers Utah (29 counties) and the adjacent states present in the file: FIPS 04, 08, 16, 32, 35, 56. Zone IDs `491`/`499` appear; trade types 1/2/3 all present; 249,847 zero-ton rows (explicit zeros again). **`3.FAF-to-FAF.csv` contains no Utah zones at all** (120 other zones), so it is the rest-of-US context table.
- Utah-touching domestic tons in the county file: 169,861 kt (both ends in Utah: 102,274 kt). FAF5.7.1 2022 says 217,325 kt, FAF6 329,980 kt. The county product is FAF5.6.1-based (per BTS); **Units resolved (Phase 4, from the BTS technical report): `tons_2022` is in thousand tons ("tons" means kilotons).** The county-to-county table alone (169,861 kt) is not comparable with FAF totals because the state zip has four tables: county-to-county for the state and every adjacent state, county-to-FAF zone and FAF zone-to-county for the rest of the country, and zone-to-zone among the other zones. Phase 4 found that the state-touching rows of the first three tables **sum to exactly FAF5.7.1's 2022 domestic tons for the state (217,325 kt), mode by mode** (mode 11 = FAF truck + air), so the product conserves FAF totals. Import and export totals differ slightly (3,121 vs 3,168 kt; 3,346 vs 3,347 kt), cause unverified.
- Disaggregation factors: 8 CSVs (`{truck,rail,water,pipeline}_{origin,destination}_factors.csv`; cols `dms_orig|dms_dest, dms_*_cnty, sctgG5, f_orig|f_dest`). Truck origin factors for zones 491/499 sum to exactly 1 per commodity group. **Zone IDs are unpadded in the factor files** (2-char for e.g. zone `020`, county FIPS unpadded `1003`, vs padded in the data tables): pad both. The water file has quoted headers/values, others do not.

## 11. FAF5 data_version semantics (for the `data_version` tag)

The BTS versions page returns 403 to scripts, so I read a Wayback snapshot (2026-05), not the live page. It says: **5.7.1 (2025-08-15) revised the 2024 preliminary annual estimates and final annual estimates for 2018-2023**; 5.7 (2025-06-25) released preliminary 2024 and final 2023. Consistent with HANDOFF: `base` 2017, `final` 2018-2023, `preliminary` 2024, `forecast` 2030-2050. The FAF5 landing page text says only "base year (2017), the recent years (2018-2024), the forecast year estimates (2030-2050)", so the final/preliminary split rests on the versions page. FAF6.0 does not appear in that (older) snapshot; the **FAF6 release date 2026-07-31 is UNVERIFIED** here (taken from HANDOFF).

## 12. Corrections to HANDOFF.md

1. 3.1/3.3: FAF6.0 CSV has only `tons_2022` and `value_2022`: **no `current_value`, no `tmiles`**.
2. FAF5.7.1: `current_value` exists only for 2018-2024; both `tons/value/tmiles` for 2017 and for 2030-2050 (5-year steps); no 2025-2029; a `dist_band` column exists (8 bands) in FAF5 regional/state files but not FAF6 or the history file.
3. State history is **4 years** (1997, 2002, 2007, 2012), not annual.
4. Zeros are **explicit rows** in FAF5 and history, so "rows exist only for positive flows" is false; drop empty rows when unpivoting.
5. Regional-to-state reconciliation is **exact**; tolerance 1e-6 suffices.
6. Network links: 487,394 (not 487,384). Assignment: 2017/2022/2050 each have **6** CSV tables in the FHWA zips (not 11 for 2050). Data dictionary mentions a 2030 baseline that is not in these zips. 2050 zip includes a copy of the network identical to the 2017 one.
7. County product is tons-only with a 5-group commodity scheme and its own mode codes (incl. `11`); `3.FAF-to-FAF` excludes the state's own zones. Source file URLs differ from `bts.gov` and follow `https://faf.ornl.gov/faf5/Data/County/<FIPS> - <Name>.zip`.
8. Parquet range reads **do not happen on GitHub Pages** (DuckDB-WASM gets 200 + gzip). PMTiles range reads work.
9. Zone GeoJSON per version is ~0.4 MB, not 1-3 MB.
10. No tippecanoe needed; DuckDB-spatial GDAL writes PMTiles.
11. `FAFZONE` in the network and the county factor files are not zero-padded; pad to 3.
12. Network link `Class` 50 centroid connectors carry flow and will skew a naive map.

## 13. Open items for you

1. ~~County mode code `11`~~ resolved (section 10). The report's text I searched does not state the unit of `tons_2022`; still **UNVERIFIED** (assume thousand tons like FAF only after checking Table 14 area of the report).
2. Check `https://ar-puuk.github.io/freight-explorer/spike.html` once in your normal browser (GPU) for the flowmap shader issue in section 9.
3. Decisions listed in `docs/DECISIONS.md` (zone anchor points, EH-only DuckDB-WASM, centroid-connector handling, TypeScript pin).
4. Not done in Phase 0: regional Hi/Lo file profile (406 MB), 2022/2050 assignment CSV profiles (2050 Total table and network compared; 2022 only listed), parsing of the FAF6 zone/CFS lookup, full long-form network flow Parquet sizing.
