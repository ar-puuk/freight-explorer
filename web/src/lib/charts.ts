import * as Plot from '@observablehq/plot';
import type { CompareSeries, OtherSeries, TrendPoint } from './controller.svelte';
import { modeColor, OKABE_ITO, type ChartColors } from './palette';

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

const base = (c: ChartColors, width: number) => ({ width, style: { background: 'transparent', color: c.text, fontSize: '12px' } });

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
    color: { type: 'sqrt', scheme: 'viridis', legend: true, label: unit },
    marks: [Plot.cell(data, { x: 'mode', y: 'commodity', fill: 'v', inset: 0.5, tip: true })],
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
  points: TrendPoint[], other: OtherSeries | null, c: ChartColors, width: number, unit: string, thisLabel: string,
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
    marginLeft: 56,
    x: { label: null, tickFormat: 'd', ticks: spacedTicks(years, width), domain: years.length > 1 ? [years[0] - 1, years[years.length - 1] + 1] : [years[0] - 2, years[0] + 2] },
    y: { label: unit, grid: true, tickFormat: comma, zero: true },
    marks,
  });
}

export function compareChart(series: CompareSeries[], c: ChartColors, width: number, unit: string): Element {
  const rows = series.flatMap((s) => s.points.map((p) => ({ ...p, label: s.label })));
  const labels = series.map((s) => s.label);
  const range = labels.map((_, i) => OKABE_ITO[i % OKABE_ITO.length]);
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const annual = rows.filter((r) => r.data_version !== 'forecast');
  const fc = rows.filter((r) => r.data_version === 'forecast');
  return Plot.plot({
    ...base(c, width),
    height: 320,
    marginLeft: 56,
    x: { label: null, tickFormat: 'd', ticks: spacedTicks(years, width), domain: years.length > 1 ? [years[0] - 1, years[years.length - 1] + 1] : undefined },
    y: { label: unit, grid: true, tickFormat: comma, zero: true },
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

export function modeStackChart(rows: { year: number; code: string; label: string; v: number }[], c: ChartColors, width: number, unit: string, share: boolean): Element {
  const labels = [...new Map(rows.map((r) => [Number(r.code), r.label])).entries()].sort((a, b) => a[0] - b[0]);
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  return Plot.plot({
    ...base(c, width),
    height: 300,
    marginLeft: 56,
    x: { label: null, type: 'band', domain: years, tickFormat: 'd', ticks: spacedTicks(years, width, 40) },
    y: { label: share ? 'share of total' : unit, grid: true, tickFormat: share ? '%' : comma },
    color: { domain: labels.map((l) => l[1]), range: labels.map((l) => modeColor(l[0])), legend: true },
    marks: [Plot.barY(rows, { x: 'year', y: 'v', fill: 'label', ...(share ? { offset: 'normalize' as const } : {}), tip: true }), Plot.ruleY([0])],
  });
}
