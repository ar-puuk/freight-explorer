import * as Plot from '@observablehq/plot';
import type { CompareSeries, OtherSeries, Trends, TrendPoint, YearsCompare } from './controller.svelte';
import { formatShort } from './format';
import { groupColor, modeColor, OKABE_ITO, type ChartColors } from './palette';
import type { Measure } from './types';
import { trunc } from './ui';

type Row = { label: string; v: number };

const comma = (d: number) => d.toLocaleString('en-US', { maximumFractionDigits: 0 });

/** Year ticks thinned so labels never collide: keep a year only if it is far enough (in pixels) from the previous kept one. */
export function spacedTicks(years: number[], width: number, minPx = 46): number[] {
  if (years.length < 2) return years;
  const span = years[years.length - 1] - years[0] + 2;
  const out: number[] = [];
  for (const y of years) if (!out.length || ((y - out[out.length - 1]) / span) * width >= minPx) out.push(y);
  return out;
}

const FONT = '"Instrument Sans", system-ui, sans-serif';

/** Y axis in the raw unit. With a measure the ticks are short (200M, $1.2B) and the unit is the chart's subtitle; without one they are full numbers. */
const yAxis = (unit: string, measure?: Measure) => (measure ? { label: null, grid: true, tickFormat: (d: number) => formatShort(measure, d), zero: true } : { label: unit, grid: true, tickFormat: comma, zero: true });
const base = (c: ChartColors, width: number) => ({ width, style: { background: 'transparent', color: c.text, fontSize: '12px', fontFamily: FONT, overflow: 'visible' } });

export function barChart(rows: Row[], c: ChartColors, width: number, unit: string, fill?: (r: Row) => string): Element {
  const h = Math.max(80, rows.length * 26 + 46);
  return Plot.plot({
    ...base(c, width),
    height: h,
    marginLeft: Math.min(210, Math.max(120, Math.floor(width * 0.42))),
    marginRight: 16,
    x: { label: unit, grid: true, tickFormat: comma },
    y: { label: null, domain: rows.map((r) => r.label) },
    marks: [Plot.barX(rows, { x: 'v', y: 'label', fill: fill ?? c.accent, tip: true }), Plot.ruleX([0], { stroke: c.muted })],
  });
}

export function heatmapChart(cells: { commodity: string; mode: string; v: number }[], c: ChartColors, width: number, unit: string, maxRows = 14): Element {
  const totals = new Map<string, number>();
  for (const d of cells) totals.set(d.commodity, (totals.get(d.commodity) ?? 0) + d.v);
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxRows).map(([k]) => k);
  const data = cells.filter((d) => top.includes(d.commodity));
  const modes = [...new Set(cells.map((d) => d.mode))].sort();
  return Plot.plot({
    ...base(c, width),
    height: top.length * 22 + 96,
    marginLeft: Math.min(210, Math.max(120, Math.floor(width * 0.4))),
    marginBottom: 54,
    x: { label: null, domain: modes, tickRotate: -30 },
    y: { label: null, domain: top },
    color: { type: 'sqrt', range: [c.panel3, c.accent], legend: true, label: unit },
    marks: [Plot.cell(data, { x: 'mode', y: 'commodity', fill: 'v', inset: 0.5, rx: 3, tip: true })],
  });
}

const STATUS_ORDER = ['base', 'final', 'preliminary', 'forecast'];

/** Where the annual estimates end and forecasts begin (midpoint of the gap), and the first preliminary year, from the data itself. */
function boundaries(points: TrendPoint[]): { preliminary: number | null; forecastAt: number | null; gap: [number, number] | null } {
  const mid = points.filter((p) => p.scenario === 'mid');
  const prelim = mid.find((p) => p.data_version === 'preliminary')?.year ?? null;
  const annual = mid.filter((p) => p.data_version !== 'forecast').map((p) => p.year);
  const fc = mid.filter((p) => p.data_version === 'forecast').map((p) => p.year);
  if (!annual.length || !fc.length) return { preliminary: prelim, forecastAt: null, gap: null };
  const lastAnnual = Math.max(...annual);
  const firstFc = Math.min(...fc);
  return { preliminary: prelim, forecastAt: (lastAnnual + firstFc) / 2, gap: firstFc - lastAnnual > 1 ? [lastAnnual, firstFc] : null };
}

/** Symbol marks by data status: diamond = benchmark, filled circle = final, hollow circle = preliminary, triangle = forecast. */
function statusDots(data: TrendPoint[], c: ChartColors, stroke: string): Plot.Markish[] {
  const d = (status: string) => data.filter((p) => p.data_version === status);
  return [
    Plot.dot(d('base'), { x: 'year', y: 'v', symbol: 'diamond', r: 6, stroke, fill: stroke }),
    Plot.dot(d('final'), { x: 'year', y: 'v', symbol: 'circle', r: 4.5, stroke, fill: stroke }),
    Plot.dot(d('preliminary'), { x: 'year', y: 'v', symbol: 'circle', r: 5, stroke, fill: c.surface, strokeWidth: 2 }),
    Plot.dot(d('forecast'), { x: 'year', y: 'v', symbol: 'triangle', r: 5, stroke, fill: stroke }),
  ];
}

export function trendChart(
  points: TrendPoint[], other: OtherSeries | null, c: ChartColors, width: number, unit: string, thisLabel: string, measure?: Measure,
): Element {
  const mid = points.filter((p) => p.scenario === 'mid').sort((a, b) => a.year - b.year);
  const low = points.filter((p) => p.scenario === 'low').sort((a, b) => a.year - b.year);
  const high = points.filter((p) => p.scenario === 'high').sort((a, b) => a.year - b.year);
  const annual = mid.filter((p) => p.data_version !== 'forecast');
  const fcast = mid.filter((p) => p.data_version === 'forecast');
  const band = low.flatMap((l) => {
    const h = high.find((x) => x.year === l.year);
    return h ? [{ year: l.year, lo: l.v, hi: h.v }] : [];
  });
  const b = boundaries(points);
  const years = [...new Set([...mid.map((p) => p.year), ...(other?.points.map((p) => p.year) ?? [])])].sort((x, y) => x - y);
  const marks: Plot.Markish[] = [];
  if (b.forecastAt != null) {
    marks.push(Plot.ruleX([b.forecastAt], { stroke: c.muted, strokeDasharray: '4 4' }));
    marks.push(Plot.text([{ x: b.forecastAt, t: 'forecasts →' }], { x: 'x', text: 't', frameAnchor: 'top', dy: 6, dx: 4, textAnchor: 'start', fill: c.muted }));
  }
  if (b.preliminary != null) {
    marks.push(Plot.ruleX([b.preliminary], { stroke: c.muted, strokeOpacity: 0.5 }));
    marks.push(Plot.text([{ x: b.preliminary, t: 'preliminary' }], { x: 'x', text: 't', frameAnchor: 'bottom', dy: -6, dx: -4, textAnchor: 'end', fill: c.muted }));
  }
  if (b.gap) marks.push(Plot.text([{ x: (b.gap[0] + b.gap[1]) / 2, t: `no estimates ${b.gap[0] + 1}–${b.gap[1] - 1}` }], { x: 'x', text: 't', frameAnchor: 'middle', fill: c.muted, fontStyle: 'italic' }));
  if (band.length) {
    marks.push(Plot.areaY(band, { x: 'year', y1: 'lo', y2: 'hi', fill: c.accent, fillOpacity: 0.16 }));
    marks.push(Plot.lineY(low, { x: 'year', y: 'v', stroke: c.accent, strokeDasharray: '2 3', strokeOpacity: 0.8 }));
    marks.push(Plot.lineY(high, { x: 'year', y: 'v', stroke: c.accent, strokeDasharray: '2 3', strokeOpacity: 0.8 }));
  }
  if (annual.length > 1) marks.push(Plot.lineY(annual, { x: 'year', y: 'v', stroke: c.accent, strokeWidth: 2 }));
  if (fcast.length > 1) marks.push(Plot.lineY(fcast, { x: 'year', y: 'v', stroke: c.accent, strokeWidth: 2, strokeDasharray: '6 4' }));
  marks.push(...statusDots(mid, c, c.accent));
  if (other) {
    const o = other.points.sort((a, z) => a.year - z.year);
    const oa = o.filter((p) => p.data_version !== 'forecast');
    if (oa.length > 1) marks.push(Plot.lineY(oa, { x: 'year', y: 'v', stroke: c.muted, strokeWidth: 1.5, strokeDasharray: '1 3' }));
    marks.push(Plot.dot(o, { x: 'year', y: 'v', symbol: 'square', r: 5, stroke: c.muted, fill: 'none', strokeWidth: 2 }));
    marks.push(Plot.text(o.slice(-1), { x: 'year', y: 'v', text: () => `FAF ${other.version} (${other.benchmarkYear} benchmark)`, dy: -12, fill: c.muted, textAnchor: 'end' }));
  }
  marks.push(Plot.tip(mid, Plot.pointer({ x: 'year', y: 'v', title: (p: TrendPoint) => `${thisLabel} ${p.year} (${p.data_version})\n${p.v.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}` })));
  return Plot.plot({
    ...base(c, width),
    height: 320,
    marginLeft: measure ? 48 : 56,
    x: { label: null, tickFormat: 'd', ticks: spacedTicks(years, width), domain: years.length > 1 ? [years[0] - 1, years[years.length - 1] + 1] : [years[0] - 2, years[0] + 2] },
    y: yAxis(unit, measure),
    marks,
  });
}

export function compareChart(series: CompareSeries[], c: ChartColors, width: number, unit: string, measure?: Measure): Element {
  const rows = series.flatMap((s) => s.points.map((p) => ({ ...p, label: s.label })));
  const labels = series.map((s) => s.label);
  const range = labels.map((_, i) => OKABE_ITO[i % OKABE_ITO.length]);
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const annual = rows.filter((r) => r.data_version !== 'forecast');
  const fc = rows.filter((r) => r.data_version === 'forecast');
  return Plot.plot({
    ...base(c, width),
    height: 320,
    marginLeft: measure ? 48 : 56,
    x: { label: null, tickFormat: 'd', ticks: spacedTicks(years, width), domain: years.length > 1 ? [years[0] - 1, years[years.length - 1] + 1] : undefined },
    y: yAxis(unit, measure),
    color: { domain: labels, range, legend: true },
    symbol: { domain: STATUS_ORDER, range: ['diamond', 'circle', 'circle', 'triangle'] },
    marks: [
      Plot.lineY(annual, { x: 'year', y: 'v', stroke: 'label', strokeWidth: 2 }),
      Plot.lineY(fc, { x: 'year', y: 'v', stroke: 'label', strokeWidth: 2, strokeDasharray: '6 4' }),
      Plot.dot(rows, { x: 'year', y: 'v', stroke: 'label', fill: (r: { label: string; data_version: string }) => (r.data_version === 'preliminary' ? c.surface : r.label), symbol: 'data_version', r: 4.5, strokeWidth: 2 }),
      Plot.tip(rows, Plot.pointer({ x: 'year', y: 'v', title: (r: { label: string; year: number; data_version: string; v: number }) => `${r.label}, ${r.year} (${r.data_version})\n${r.v.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}` })),
    ],
  });
}

export function modeStackChart(rows: { year: number; code: string; label: string; v: number }[], c: ChartColors, width: number, unit: string, share: boolean, measure?: Measure): Element {
  const labels = [...new Map(rows.map((r) => [Number(r.code), r.label])).entries()].sort((a, b) => a[0] - b[0]);
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  return Plot.plot({
    ...base(c, width),
    height: 300,
    marginLeft: 56,
    x: { label: null, type: 'band', domain: years, tickFormat: 'd', ticks: spacedTicks(years, width, 40) },
    y: share ? { label: measure ? null : 'share of total', grid: true, tickFormat: '%' } : yAxis(unit, measure),
    color: { domain: labels.map((l) => l[1]), range: labels.map((l) => modeColor(l[0])), legend: true },
    marks: [Plot.barY(rows, { x: 'year', y: 'v', fill: 'label', ...(share ? { offset: 'normalize' as const } : {}), tip: true }), Plot.ruleY([0])],
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// History (FAF5 reprocessed, state level, snapshot years). Separate marks and labels: never one line with the annual series.

import type { HistorySeries } from './controller.svelte';

/** Totals at the four snapshot years, optionally beside the FAF5 annual estimates (a separate, differently marked series). */
export function historyTotalsChart(
  totals: { year: number; v: number }[], faf5: TrendPoint[] | null, faf5Label: string, c: ChartColors, width: number, unit: string, measure?: Measure,
): Element {
  const years = [...new Set([...totals.map((t) => t.year), ...(faf5?.map((p) => p.year) ?? [])])].sort((a, b) => a - b);
  const marks: Plot.Markish[] = [];
  if (faf5?.length) {
    const f5 = faf5.slice().sort((a, b) => a.year - b.year);
    const divider = (Math.max(...totals.map((t) => t.year)) + Math.min(...f5.map((p) => p.year))) / 2;
    marks.push(Plot.ruleX([divider], { stroke: c.muted, strokeDasharray: '4 4' }));
    marks.push(Plot.text([{ x: divider, t: `${faf5Label} annual →` }], { x: 'x', text: 't', frameAnchor: 'top', dy: 6, dx: 4, textAnchor: 'start', fill: c.muted }));
    if (f5.length > 1) marks.push(Plot.lineY(f5, { x: 'year', y: 'v', stroke: c.muted, strokeWidth: 1.5 }));
    marks.push(Plot.dot(f5, { x: 'year', y: 'v', symbol: 'circle', r: 4, stroke: c.muted, fill: (p: TrendPoint) => (p.data_version === 'preliminary' ? c.surface : c.muted), strokeWidth: 2 }));
  }
  marks.push(Plot.lineY(totals, { x: 'year', y: 'v', stroke: c.accent, strokeWidth: 2, strokeDasharray: '2 3' }));
  marks.push(Plot.dot(totals, { x: 'year', y: 'v', symbol: 'cross', r: 6, stroke: c.accent, strokeWidth: 2.5 }));
  marks.push(Plot.tip(totals, Plot.pointer({ x: 'year', y: 'v', title: (t: { year: number; v: number }) => `${t.year} (historical snapshot)\n${t.v.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}` })));
  return Plot.plot({
    ...base(c, width),
    height: 300,
    marginLeft: measure ? 48 : 56,
    x: { label: null, tickFormat: 'd', ticks: spacedTicks(years, width), domain: [years[0] - 1, years[years.length - 1] + 1] },
    y: yAxis(unit, measure),
    marks,
  });
}

/** One line per series across the snapshot years (partners or commodities), colorblind-safe colors plus direct labels at the line ends. */
export function snapshotLinesChart(series: HistorySeries[], c: ChartColors, width: number, unit: string, measure?: Measure): Element {
  const rows = series.flatMap((s) => s.points.map((p) => ({ ...p, label: s.label })));
  const labels = series.map((s) => s.label);
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const last = series.flatMap((s) => (s.points.length ? [{ ...s.points[s.points.length - 1], label: s.label }] : []));
  return Plot.plot({
    ...base(c, width),
    height: 300,
    marginLeft: measure ? 48 : 56,
    marginRight: Math.min(190, Math.floor(width * 0.3)),
    x: { label: null, tickFormat: 'd', ticks: years, domain: [years[0] - 1, years[years.length - 1] + 1] },
    y: yAxis(unit, measure),
    color: { domain: labels, range: labels.map((_, i) => OKABE_ITO[i % OKABE_ITO.length]) },
    marks: [
      Plot.lineY(rows, { x: 'year', y: 'v', stroke: 'label', strokeWidth: 2 }),
      Plot.dot(rows, { x: 'year', y: 'v', stroke: 'label', fill: 'label', r: 3.5 }),
      Plot.text(last, { x: 'year', y: 'v', text: 'label', fill: 'label', dx: 8, textAnchor: 'start', lineWidth: 14 }),
      Plot.tip(rows, Plot.pointer({ x: 'year', y: 'v', title: (r: { label: string; year: number; v: number }) => `${r.label}, ${r.year}\n${r.v.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}` })),
    ],
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Redesign charts. A "gap" band marks years the release does not publish: hatched, never interpolated.

const HATCH = '#fe00fe'; // placeholder fill, swapped for the hatch pattern after the chart is built

/** Replace the placeholder fill with a diagonal hatch (missing data), keeping the chart's own colors theme-aware. */
export function hatchify(svg: SVGSVGElement | Element, c: ChartColors): void {
  const id = `hatch${Math.random().toString(36).slice(2, 7)}`;
  svg.insertAdjacentHTML('afterbegin', `<defs><pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${c.grid}" stroke-width="1.4"/></pattern></defs>`);
  for (const e of svg.querySelectorAll(`[fill="${HATCH}"]`)) e.setAttribute('fill', `url(#${id})`);
}

const yearTick = (d: string) => (d === 'gap' ? '' : `\u2019${d.slice(2)}`);

/** Year domain with one 'gap' slot where the release jumps from annual years to sparse forecasts. */
function yearDomain(years: number[]): string[] {
  const out: string[] = [];
  let prevStep = 0;
  years.forEach((y, i) => {
    const step = i > 0 ? y - years[i - 1] : 0;
    if (step > 1 && prevStep === 1) out.push('gap');
    out.push(String(y));
    if (i > 0) prevStep = step;
  });
  return out;
}

/** Inbound, outbound and within as stacked bars by year, with the published High and Low scenarios as whiskers on forecast years. */
export function directionChart(
  rows: Trends['directions'], scenario: string, selectedYear: number, c: ChartColors, width: number, measure: Measure, label: (dir: string) => string,
): Element {
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const sc = (year: number) => (rows.some((r) => r.year === year && r.scenario === scenario) ? scenario : 'mid');
  const bars = rows.filter((r) => r.scenario === sc(r.year)).map((r) => ({ x: String(r.year), year: r.year, dir: r.dir, v: r.v }));
  const total = (year: number, s: string) => rows.filter((r) => r.year === year && r.scenario === s).reduce((a, r) => a + r.v, 0);
  const whisk = years.flatMap((y) => {
    const hi = rows.some((r) => r.year === y && r.scenario === 'high') ? total(y, 'high') : null;
    const lo = rows.some((r) => r.year === y && r.scenario === 'low') ? total(y, 'low') : null;
    return hi != null && lo != null ? [{ x: String(y), hi, lo }] : [];
  });
  const sums = new Map<number, number>();
  for (const b of bars) sums.set(b.year, (sums.get(b.year) ?? 0) + b.v);
  const ymax = Math.max(1, ...sums.values(), ...whisk.map((w) => w.hi)) * 1.1;
  const domain = yearDomain(years);
  const marks: Plot.Markish[] = [];
  if (domain.includes('gap')) {
    marks.push(Plot.barY([{ x: 'gap', v: ymax }], { x: 'x', y: 'v', fill: HATCH }));
    marks.push(Plot.text([{ x: 'gap', y: ymax / 2 }], { x: 'x', y: 'y', text: ['not published'], rotate: -90, fill: c.muted, fontSize: 10.5 }));
  }
  marks.push(
    Plot.barY(bars, { x: 'x', y: 'v', fill: 'dir', fillOpacity: (d: { year: number }) => (d.year === selectedYear ? 1 : 0.62), title: (d: { year: number; dir: string; v: number }) => `${d.year} \u00b7 ${label(d.dir)}\n${formatShort(measure, d.v)}`, tip: true }),
    Plot.ruleY([0], { stroke: c.grid }),
    Plot.ruleX(whisk, { x: 'x', y1: 'lo', y2: 'hi', stroke: c.text, strokeWidth: 1.4 }),
    Plot.dot(whisk, { x: 'x', y: 'hi', r: 2.2, fill: c.text }),
    Plot.dot(whisk, { x: 'x', y: 'lo', r: 2.2, fill: c.text }),
  );
  const chart = Plot.plot({
    ...base(c, width), height: 240, marginLeft: 46, marginRight: 4, marginBottom: 24, marginTop: 8,
    x: { domain, label: null, tickSize: 0, padding: 0.2, tickFormat: yearTick },
    y: { domain: [0, ymax], grid: true, label: null, tickFormat: (d: number) => formatShort(measure, d) },
    color: { domain: ['inbound', 'outbound', 'within'], range: [c.inbound, c.outbound, c.within] },
    marks,
  });
  hatchify(chart, c);
  return chart;
}

/** Commodity by year as a heatmap (square-root color scale so small groups stay visible); the selected year is outlined. */
export function commodityHeatChart(
  rows: { year: number; code: string; label: string; v: number }[], selectedYear: number, c: ChartColors, width: number, measure: Measure, maxRows = 14,
): Element {
  const totals = new Map<string, { label: string; v: number }>();
  for (const r of rows) totals.set(r.code, { label: r.label, v: (totals.get(r.code)?.v ?? 0) + r.v });
  const top = [...totals.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, maxRows);
  const names = top.map(([, t]) => t.label);
  const codeName = new Map(top.map(([k, t]) => [k, t.label]));
  const data = rows.filter((r) => codeName.has(r.code)).map((r) => ({ x: String(r.year), year: r.year, y: codeName.get(r.code)!, v: r.v }));
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const mx = Math.max(1, ...data.map((d) => d.v));
  const chart = Plot.plot({
    ...base(c, width), height: top.length * 22 + 36, marginLeft: 128, marginRight: 2, marginBottom: 24, marginTop: 4,
    x: { domain: yearDomain(years), label: null, tickSize: 0, padding: 0.08, tickFormat: yearTick },
    y: { domain: names, label: null, tickSize: 0, padding: 0.08, tickFormat: (d: string) => trunc(d, 22) },
    color: { type: 'sqrt', domain: [0, mx], range: [c.panel3, c.accent] },
    marks: [Plot.cell(data, { x: 'x', y: 'y', fill: 'v', rx: 3, inset: 0.5, stroke: (d: { year: number }) => (d.year === selectedYear ? c.text : 'none'), strokeWidth: 1.6, title: (d: { y: string; year: number; v: number }) => `${d.y}\n${d.year}: ${formatShort(measure, d.v)}`, tip: true })],
  });
  return chart;
}

/** Start and end for each item on one row: a dumbbell, ordered by size, with the percent change as a label. */
export function dumbbellChart(
  rows: { label: string; a: number; b: number }[], a: number, b: number, c: ChartColors, width: number, measure: Measure,
): Element {
  const data = rows.filter((r) => r.a || r.b).sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b)).slice(0, 14);
  const pct = (d: { a: number; b: number }) => (d.a ? `${((d.b - d.a) / d.a) * 100 >= 0 ? '+' : ''}${(((d.b - d.a) / d.a) * 100).toFixed(0)}%` : 'new');
  return Plot.plot({
    ...base(c, width), height: data.length * 27 + 34, marginLeft: 140, marginRight: 60, marginTop: 6, marginBottom: 24,
    x: { grid: true, label: null, tickFormat: (d: number) => formatShort(measure, d), ticks: 4 },
    y: { domain: data.map((d) => d.label), label: null, tickSize: 0, tickFormat: (d: string) => trunc(d, 21) },
    marks: [
      Plot.ruleY(data, { y: 'label', x1: 'a', x2: 'b', stroke: c.grid, strokeWidth: 3, strokeLinecap: 'round' }),
      Plot.dot(data, { y: 'label', x: 'a', r: 5, fill: c.surface, stroke: c.muted, strokeWidth: 2, title: (d: { label: string; a: number }) => `${d.label}\n${a}: ${formatShort(measure, d.a)}` }),
      Plot.dot(data, { y: 'label', x: 'b', r: 5, fill: c.accent, title: (d: { label: string; b: number }) => `${d.label}\n${b}: ${formatShort(measure, d.b)}` }),
      Plot.text(data, { y: 'label', x: (d: { a: number; b: number }) => Math.max(d.a, d.b), dx: 10, textAnchor: 'start', fill: c.muted, fontSize: 10.5, text: pct }),
    ],
  });
}

/** Percent change by item around a zero line. Items missing in one of the two years are left out (a change from nothing is not a percentage). */
export function deltaBarsChart(rows: { label: string; code: string; a: number; b: number }[], c: ChartColors, width: number, color: (code: string) => string): Element {
  const data = rows.filter((r) => r.a > 0 && r.b >= 0).map((r) => ({ label: r.label, code: r.code, d: ((r.b - r.a) / r.a) * 100 })).sort((x, y) => y.d - x.d);
  const ext = Math.max(5, ...data.map((d) => Math.abs(d.d)));
  const sign = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(0)}%`;
  const label = (anchor: 'start' | 'end', dd: typeof data) =>
    Plot.text(dd, { y: 'label', x: 'd', text: (d: { d: number }) => sign(d.d), dx: anchor === 'start' ? 6 : -6, textAnchor: anchor, fill: c.muted, fontSize: 10.5 });
  return Plot.plot({
    ...base(c, width), height: data.length * 30 + 34, marginLeft: 118, marginRight: 46, marginTop: 4, marginBottom: 24,
    x: { grid: true, label: null, domain: [-ext * 1.15, ext * 1.15], tickFormat: (d: number) => `${d > 0 ? '+' : ''}${d}%`, ticks: 5 },
    y: { domain: data.map((d) => d.label), label: null, tickSize: 0, tickFormat: (d: string) => trunc(d, 22) },
    marks: [
      Plot.barX(data, { y: 'label', x: 'd', fill: (d: { code: string }) => color(d.code), rx: 3, title: (d: { label: string; d: number }) => `${d.label}: ${sign(d.d)}` }),
      Plot.ruleX([0], { stroke: c.muted }),
      label('start', data.filter((d) => d.d >= 0)),
      label('end', data.filter((d) => d.d < 0)),
    ],
  });
}

export { groupColor, yearDomain };
