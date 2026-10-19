import type { Dollars, Measure } from './types';

const sig3 = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 });
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function scaled(v: number, steps: { at: number; div: number; unit: string }[], base: string): { text: string; unit: string } {
  const abs = Math.abs(v);
  for (const s of steps) {
    if (abs >= s.at) return { text: sig3.format(v / s.div), unit: s.unit };
  }
  return { text: sig3.format(v), unit: base };
}

/** Tons arrive in thousand tons. */
export function formatTons(kt: number | null | undefined): string {
  if (kt == null || Number.isNaN(kt)) return 'not published';
  const r = scaled(kt, [{ at: 1e6, div: 1e6, unit: 'billion tons' }, { at: 1e3, div: 1e3, unit: 'million tons' }], 'thousand tons');
  return `${r.text} ${r.unit}`;
}

/** Value arrives in million dollars; the dollar basis is part of the label. */
export function formatValue(musd: number | null | undefined, dollars: Dollars, benchmarkYear: number): string {
  if (musd == null || Number.isNaN(musd)) return 'not published';
  const r = scaled(musd, [{ at: 1e6, div: 1e6, unit: 'trillion' }, { at: 1e3, div: 1e3, unit: 'billion' }], 'million');
  const basis = dollars === 'const' ? `${benchmarkYear} dollars` : 'current dollars';
  return `$${r.text} ${r.unit} (${basis})`;
}

/** Ton-miles arrive in million ton-miles. */
export function formatTonMiles(m: number | null | undefined): string {
  if (m == null || Number.isNaN(m)) return 'not published';
  const r = scaled(m, [{ at: 1e6, div: 1e6, unit: 'trillion ton-miles' }, { at: 1e3, div: 1e3, unit: 'billion ton-miles' }], 'million ton-miles');
  return `${r.text} ${r.unit}`;
}

/** Dollars per ton from million dollars and thousand tons. */
export function formatValuePerTon(musd: number | null | undefined, kt: number | null | undefined): string {
  if (musd == null || kt == null || !kt) return 'not published';
  return `$${int.format((musd / kt) * 1000)} per ton`;
}

export function formatMeasure(measure: Measure, v: number | null | undefined, dollars: Dollars, benchmarkYear: number): string {
  if (measure === 'tons') return formatTons(v);
  if (measure === 'tmiles') return formatTonMiles(v);
  return formatValue(v, dollars, benchmarkYear);
}

/** Raw unit of the measure, for sliders and axis labels. */
export function rawUnit(measure: Measure): string {
  return measure === 'tons' ? 'thousand tons' : measure === 'tmiles' ? 'million ton-miles' : 'million dollars';
}

export function formatPercent(frac: number): string {
  if (!Number.isFinite(frac)) return '0%';
  const p = frac * 100;
  return `${p >= 99.95 ? '100' : p >= 10 ? p.toFixed(0) : p.toFixed(1)}%`;
}

export function formatCount(n: number): string {
  return int.format(n);
}

// ---------------------------------------------------------------------------------------------------------------------
// Compact forms for the headline band, charts and lists. Units stay words in the headline and short letters in charts.

const dec = (x: number): string => (x >= 100 ? int : x >= 10 ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }) : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })).format(x);

/** Short chart form: 223M, 845K, $248B, 89B. */
export function formatShort(measure: Measure, v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return 'n/a';
  if (measure === 'tons') return Math.abs(v) >= 1e6 ? `${dec(v / 1e6)}B` : Math.abs(v) >= 1e3 ? `${dec(v / 1e3)}M` : `${dec(v)}K`;
  const r = Math.abs(v) >= 1e6 ? `${dec(v / 1e6)}T` : Math.abs(v) >= 1e3 ? `${dec(v / 1e3)}B` : `${dec(v)}M`;
  return measure === 'value' ? `$${r}` : r;
}

/** Headline form: a number and a unit word, with no dollar basis (the basis is shown next to it). */
export function formatBig(measure: Measure, v: number | null | undefined): { n: string; u: string } {
  if (v == null || Number.isNaN(v)) return { n: 'n/a', u: 'not published' };
  const a = Math.abs(v);
  const f = (x: number) => (a >= 1e5 ? int : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })).format(x);
  if (measure === 'tons') return a >= 1e6 ? { n: f(v / 1e6), u: 'billion tons' } : a >= 1e3 ? { n: f(v / 1e3), u: 'million tons' } : { n: int.format(v), u: 'thousand tons' };
  if (measure === 'value') return a >= 1e6 ? { n: `$${f(v / 1e6)}`, u: 'trillion' } : a >= 1e3 ? { n: `$${f(v / 1e3)}`, u: 'billion' } : { n: `$${int.format(v)}`, u: 'million' };
  return a >= 1e6 ? { n: f(v / 1e6), u: 'trillion' } : a >= 1e3 ? { n: f(v / 1e3), u: 'billion' } : { n: int.format(v), u: 'million' };
}

/** Percent change from `prev` to `cur`, or null when it cannot be computed (a missing or zero base). */
export function percentChange(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur == null || prev == null || !prev) return null;
  return ((cur - prev) / prev) * 100;
}

/** Axis tick label for a measure in its raw unit: 200M, $1.2B. */
export function axisTick(measure: Measure): (d: number) => string {
  return (d) => formatShort(measure, d);
}
