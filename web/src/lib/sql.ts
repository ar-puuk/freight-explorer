import type { Direction, Dollars, Measure, View } from './types';

/** Everything that decides which flow rows and which numbers a query returns. */
export interface FlowFilter {
  view: View;
  direction: Direction;
  commodities: string[];
  modes: number[];
  measure: Measure;
  dollars: Dollars;
}

export function measureColumn(measure: Measure, dollars: Dollars): string {
  if (measure === 'tons') return 'tons_kt';
  if (measure === 'tmiles') return 'tmiles_m';
  return dollars === 'current' ? 'value_current_musd' : 'value_const_musd';
}

/** Which two columns are the arc endpoints in each view. Import/export arcs run to/from the foreign region. */
export function endpoints(view: View): { o: string; d: string } {
  if (view === 'import') return { o: 'fr_orig', d: 'dms_dest' };
  if (view === 'export') return { o: 'dms_orig', d: 'fr_dest' };
  return { o: 'dms_orig', d: 'dms_dest' };
}

const ZONE_RX = /^\d{3}$/;
const SCTG_RX = /^\d{2}$/;

function inList(values: string[], rx: RegExp): string {
  const bad = values.filter((v) => !rx.test(v));
  if (bad.length) throw new Error(`invalid code(s): ${bad.join(', ')}`);
  return values.map((v) => `'${v}'`).join(', ');
}

/** Direction is defined on the domestic leg (dms_orig -> dms_dest) in every view. */
export function directionClause(direction: Direction, stateZones: string[]): string | null {
  if (direction === 'both') return null;
  const s = inList(stateZones, ZONE_RX);
  if (direction === 'inbound') return `(dms_dest IN (${s}) AND dms_orig NOT IN (${s}))`;
  if (direction === 'outbound') return `(dms_orig IN (${s}) AND dms_dest NOT IN (${s}))`;
  return `(dms_orig IN (${s}) AND dms_dest IN (${s}))`;
}

export function whereClause(f: FlowFilter, stateZones: string[], opts: { ignoreDirection?: boolean } = {}): string {
  const parts: string[] = [];
  if (f.view === 'domestic') parts.push('trade_type = 1');
  if (f.view === 'import') parts.push('trade_type = 2');
  if (f.view === 'export') parts.push('trade_type = 3');
  if (!opts.ignoreDirection) {
    const dir = directionClause(f.direction, stateZones);
    if (dir) parts.push(dir);
  }
  if (f.commodities.length) parts.push(`sctg2 IN (${inList(f.commodities, SCTG_RX)})`);
  if (f.modes.length) {
    if (f.modes.some((m) => !Number.isInteger(m))) throw new Error('invalid mode code');
    parts.push(`dms_mode IN (${f.modes.join(', ')})`);
  }
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

function involving(f: FlowFilter, id: string | null): string {
  if (!id) return '';
  if (!ZONE_RX.test(id)) throw new Error('invalid location id');
  const { o, d } = endpoints(f.view);
  return ` AND (${o} = '${id}' OR ${d} = '${id}')`;
}

/** Aggregated OD flows, largest first. `limit` null = no limit. `minValue` in the measure's raw unit. */
export function flowsSql(src: string, f: FlowFilter, stateZones: string[], limit: number | null, minValue: number, selected: string | null = null): string {
  const m = measureColumn(f.measure, f.dollars);
  const { o, d } = endpoints(f.view);
  return (
    `SELECT ${o} AS origin, ${d} AS dest, sum(${m}) AS magnitude FROM ${src} ` +
    `WHERE ${whereClause(f, stateZones)}${involving(f, selected)} AND ${o} IS NOT NULL AND ${d} IS NOT NULL ` +
    `GROUP BY 1, 2 HAVING sum(${m}) > ${Number.isFinite(minValue) && minValue > 0 ? minValue : 0} ` +
    `ORDER BY magnitude DESC, origin, dest${limit ? ` LIMIT ${Math.floor(limit)}` : ''}`
  );
}

/** Count and sum of all aggregated flows (before top-N), for the honest "showing X of Y" line. */
export function flowTotalsSql(src: string, f: FlowFilter, stateZones: string[], minValue: number, selected: string | null = null): string {
  const m = measureColumn(f.measure, f.dollars);
  const { o, d } = endpoints(f.view);
  return (
    `SELECT count(*)::INTEGER AS n, coalesce(sum(s), 0) AS total FROM (` +
    `SELECT sum(${m}) AS s FROM ${src} WHERE ${whereClause(f, stateZones)}${involving(f, selected)} AND ${o} IS NOT NULL AND ${d} IS NOT NULL ` +
    `GROUP BY ${o}, ${d} HAVING sum(${m}) > ${Number.isFinite(minValue) && minValue > 0 ? minValue : 0})`
  );
}

/** One row of headline numbers for the current selection. NULL sums mean the measure is not published. */
export function kpiSql(src: string, f: FlowFilter, stateZones: string[]): string {
  return (
    `SELECT sum(tons_kt) AS tons_kt, sum(value_const_musd) AS value_const_musd, sum(value_current_musd) AS value_current_musd, ` +
    `sum(tmiles_m) AS tmiles_m, count(*)::INTEGER AS rows FROM ${src} WHERE ${whereClause(f, stateZones)}`
  );
}

/** Inbound / outbound / within split for the current filters, ignoring the direction filter itself. */
export function balanceSql(src: string, f: FlowFilter, stateZones: string[]): string {
  const s = inList(stateZones, ZONE_RX);
  const m = measureColumn(f.measure, f.dollars);
  return (
    `SELECT CASE WHEN dms_orig IN (${s}) AND dms_dest IN (${s}) THEN 'within' WHEN dms_dest IN (${s}) THEN 'inbound' ELSE 'outbound' END AS dir, ` +
    `sum(${m}) AS magnitude FROM ${src} WHERE ${whereClause(f, stateZones, { ignoreDirection: true })} GROUP BY 1`
  );
}

export function modeSharesSql(src: string, f: FlowFilter, stateZones: string[]): string {
  const m = measureColumn(f.measure, f.dollars);
  return `SELECT dms_mode AS code, sum(${m}) AS magnitude FROM ${src} WHERE ${whereClause(f, stateZones)} GROUP BY 1 HAVING sum(${m}) > 0 ORDER BY magnitude DESC`;
}

/** Breakdown of the current selection (optionally restricted to flows involving one location) by a dimension column. */
export function breakdownSql(src: string, f: FlowFilter, stateZones: string[], column: 'sctg2' | 'dms_mode' | 'trade_type', selected: string | null, limit = 8): string {
  const m = measureColumn(f.measure, f.dollars);
  return (
    `SELECT ${column} AS code, sum(${m}) AS magnitude FROM ${src} WHERE ${whereClause(f, stateZones)}${involving(f, selected)} ` +
    `GROUP BY 1 HAVING sum(${m}) > 0 ORDER BY magnitude DESC LIMIT ${Math.floor(limit)}`
  );
}

/** Breakdown for one specific OD pair (both endpoints fixed), used by the flow detail panel. */
export function pairBreakdownSql(src: string, f: FlowFilter, stateZones: string[], column: 'sctg2' | 'dms_mode' | 'trade_type', origin: string, dest: string, limit = 8): string {
  if (!ZONE_RX.test(origin) || !ZONE_RX.test(dest)) throw new Error('invalid location id');
  const m = measureColumn(f.measure, f.dollars);
  const { o, d } = endpoints(f.view);
  return (
    `SELECT ${column} AS code, sum(${m}) AS magnitude FROM ${src} WHERE ${whereClause(f, stateZones)} AND ${o} = '${origin}' AND ${d} = '${dest}' ` +
    `GROUP BY 1 HAVING sum(${m}) > 0 ORDER BY magnitude DESC LIMIT ${Math.floor(limit)}`
  );
}
