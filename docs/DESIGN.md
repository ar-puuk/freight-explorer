# Design system

The interface is a map-first workspace. This file records the rules the components follow, so a change can be checked against them. The reasoning for each decision (principle, alternative rejected, cost) was written up in the redesign proposal; the decisions that changed the code are in `DECISIONS.md` under Phase 6.

## Layout

| Region | Contains | Component |
| --- | --- | --- |
| Top bar | brand, state, search (Ctrl K), methodology, copy link, copy citation, theme, help | `TopBar` |
| Query row | Filters and Insights toggles, the view written as a sentence, removable filter chips | `QueryBar` |
| Headline band | tons, value, ton-miles, value per ton, each with change against the previous published year | `HeadlineBand` |
| Filter rail (left) | dataset, measure, shipment type, direction, mode, commodity, map detail, layers, display | `FilterRail` |
| Map | flows, zone circles and tint, truck network, edge labels, legend, one data note | `MapOverlays`, `mapview.ts` |
| Timeline dock | play, year, status, scenario, sparkline, year ticks with the unpublished gap hatched | `TimelineDock` |
| Insight drawer (right) | Overview, Trends, Partners, Compare, History, Data | `InsightDrawer` and the tab components |

At 1100 px and wider everything is docked and either side can be collapsed (F, I). Below that the rail and drawer slide over the map and close with Escape. Below 760 px the headline band scrolls sideways with snap and the map controls stay at the top right.

## Tokens

Defined in `web/src/app.css`; every color in the app, the map and the charts comes from them.

- **Neutrals:** cool grays (`--bg`, `--panel`, `--panel-2`, `--panel-3`, `--line`, `--line-2`, `--ink`, `--ink-2`, `--ink-3`). Text is at least 4.8:1 on every panel surface in both themes.
- **Accent:** one ultramarine (`--accent`) for controls and selection only.
- **Data hues:** inbound `--in` (teal), outbound `--out` (orange), within the state `--within` (slate). They are never used as UI accent. At least 3:1 against their surfaces; a color-blind palette (blue, orange, gray) is one switch in Display (`data-cb="1"`).
- **Categorical:** `--k1` to `--k12`, one fixed color per commodity group in every view; modes map onto the same set (`palette.ts`).
- **Status:** `--good`, `--warn`, `--exp` (experimental), each with a text variant that meets AA on its tinted pill.
- **Type:** Instrument Sans (interface), Instrument Serif (the headline numbers, the selected year), IBM Plex Mono (values and codes). Bundled as woff2; nothing loads from a CDN.
- **Shape:** 6 px controls, 10 px cards, 14 px dialogs, full radius for pills and chips. Only things that float over the map (tools, legend, note, tooltip, dialogs) get a shadow and blur.

Light is the default; dark applies when `<html data-theme="dark">` (set from the theme preference or the system). The two are tuned separately, not inverted.

## Rules the components enforce

1. **State is a sentence.** Anything that narrows the data appears as a removable chip in the query row.
2. **Every number carries its status.** A status pill (benchmark, final, preliminary, forecast, experimental) sits in the sentence, the timeline and the data passport; units and dollar basis sit with the number.
3. **Not published is never zero.** Headline cells say "n/a" and why, charts leave cells empty, tables print "n/a", and a control with no data stays visible, disabled, with a reason.
4. **A gap is data.** The timeline and the trend charts show 2025 to 2029 as a hatched column, never as an interpolated line; Play steps only through published years.
5. **Models are never merged.** FAF5.7.1 and FAF6.0 are compared in two columns with their own scales, behind a warning.
6. **Direction is never only a color.** Inbound, outbound and within also differ in position (butterfly chart), label and legend text.
7. **Charts are controls.** Clicking a mode, commodity, partner, flow, year or zone changes the one shared state, and every view follows.
8. **Pictures first.** Each question has a chart; exact values are one disclosure ("Exact values") or the Data tab away.
9. **Nothing moves unless asked.** No animation on load; transitions are short and stop under reduced motion.

## Interaction

- Segmented controls for two to four exclusive options, switches for layers, a range slider with its value for "flows drawn", a number field for thresholds, checklists with size bars for mode and commodity, radio cards for the dataset.
- Timeline: click, drag, arrow keys, `[` and `]`, Space to play. Scenario is enabled only for forecast years; picking an annual year returns to mid-range.
- Search and jump (Ctrl K or `/`) reaches every dataset, measure, year, scenario, tab, commodity group, mode, zone, layer and action.
- Map: drag, wheel, pinch and arrow keys; click a zone or flow for details; chips on the map edge label large partners that are off screen and isolate their flows when pressed.

## Accessibility

WCAG 2.2 AA is the target. Checked with axe-core (wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa) on every tab and dataset in both themes at 1440 px, and on the map, filter sheet and insight sheet at 390 px; keyboard operation of the timeline, tabs, treemap, partner bars, palette and dialogs; no horizontal scroll at 390 px. Charts have a title with units, hover details and an "Exact values" table; the treemap and partner bars carry full text labels; the largest flows are listed as text for the map. This is not a substitute for testing with assistive technology.
