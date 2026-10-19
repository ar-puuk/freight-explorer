import type { Dir } from './types';

/** Data status, in words, and the pill class that carries it. Status is always text as well as color. */
export const STATUS_LABEL: Record<string, string> = {
  base: 'Benchmark year',
  final: 'Final estimate',
  preliminary: 'Preliminary',
  forecast: 'Forecast',
  experimental: 'Experimental',
  historical: 'Historical',
};
export const STATUS_PILL: Record<string, string> = { base: 'base', final: 'final', preliminary: 'prelim', forecast: 'fc', experimental: 'exp', historical: 'base' };
export const STATUS_TICK: Record<string, string> = { base: 'base', preliminary: 'prelim', forecast: 'fcst' };

export const DIR_LABEL: Record<Dir, string> = { inbound: 'Inbound', outbound: 'Outbound', within: 'Within state' };
export const DIRS: Dir[] = ['inbound', 'outbound', 'within'];

export const trunc = (s: string, n = 22): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Mode names without the parenthetical qualifiers, for tight spaces. */
export const shortMode = (s: string): string => s.replace(/ \(.*\)/, '');

/** Names of the three views, as written in the query sentence. */
export const VIEW_LABEL: Record<string, string> = { total: 'all shipments', domestic: 'domestic shipments', import: 'imports', export: 'exports' };

export interface TimelineCol {
  kind: 'year' | 'gap';
  year?: number;
  label: string;
}

/**
 * Columns of the timeline: every year the release publishes, with one hatched column wherever there is a gap of more than a
 * year between two published years. The axis is not linear, so the gap column is the break marker. A gap is data, not zero.
 */
export function timelineColumns(years: number[]): TimelineCol[] {
  const out: TimelineCol[] = [];
  let prevStep = 0;
  years.forEach((y, i) => {
    const step = i > 0 ? y - years[i - 1] : 0;
    // a jump after a run of annual years is a gap in the release; evenly spaced forecast years are not
    if (step > 1 && prevStep === 1) {
      const a = years[i - 1] + 1;
      const b = y - 1;
      out.push({ kind: 'gap', label: a === b ? String(a) : `${a}–${String(b).slice(-2)}` });
    }
    out.push({ kind: 'year', year: y, label: String(y) });
    if (i > 0) prevStep = step;
  });
  return out;
}
