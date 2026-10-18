# Changelog

All notable changes to this project. Dates are when the work was done; data releases are described on the methodology page.

## 0.1.0 (2026-10-18)

First complete version, built phase by phase from `HANDOFF.md`. Decisions and deviations are in `docs/DECISIONS.md`; what the real files turned out to contain is in `docs/SPIKES.md`.

- **Pipeline:** download with manifest and hashes, column-map guard that fails on any unknown column or unclassified year, state filter derived from the zone lookup, deterministic Parquet/GeoJSON/PMTiles, column dictionary, and a validation suite (including regional-to-state reconciliation for every year and scenario).
- **Data:** FAF5.7.1 (2017 to 2050, mid-range, High and Low) and FAF6.0 (2022), zone shapes and anchors, the FAF5 truck network with 2017/2022/2050 link flows, FAF5-reprocessed state history (1997 to 2012), and the experimental county estimates with their disaggregation factors.
- **App:** OD flow map, filters, KPIs, detail panels, charts (summary, trends with forecast and preliminary markers and the scenario band, compare, history), table and CSV export, network layer, light/dark themes, five basemaps, shareable URL state.
- **Polish:** methodology page, accessibility pass (WCAG 2.2 AA axe checks on every view, keyboard operation, 320 px reflow), tolerance for an unreachable basemap, content-security policy, chart code loaded on demand.
- A first run for a second state (Colorado) in a scratch clone needed one fix (the literal check no longer flags a FIPS code that is also an SCTG code in YAML code tables).
