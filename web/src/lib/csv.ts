export type Cell = string | number | boolean | null | undefined;

/** RFC 4180 quoting: wrap in quotes when the value holds a comma, quote or line break; double embedded quotes. */
export function csvCell(v: Cell): string {
  if (v == null) return '';
  const s = typeof v === 'number' && !Number.isFinite(v) ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Self-describing measure headers: the unit is part of the name. */
export const MEASURE_HEADERS: Record<string, string> = {
  tons_kt: 'tons_thousand',
  value_const_musd: 'value_constant_million_usd',
  value_current_musd: 'value_current_million_usd',
  tmiles_m: 'ton_miles_million',
};

export interface ExportMeta {
  faf_version: string;
  scenario: string;
  year: number;
  data_version: string;
  view: string;
  direction: string;
  dollar_basis: string; // e.g. "constant 2017 dollars" or "current dollars"
}

/** Metadata columns come first so every exported row says what it is (version, scenario, year, status, dollar basis). */
export function tableToCsv(meta: ExportMeta, dimHeaders: string[], rows: Record<string, Cell>[], dimKeys: string[]): string {
  const metaHeaders = ['faf_version', 'scenario', 'year', 'data_version', 'flow_view', 'direction', 'dollar_basis'];
  const measures = Object.keys(MEASURE_HEADERS);
  const headers = [...metaHeaders, ...dimHeaders, ...measures.map((m) => MEASURE_HEADERS[m])];
  const m = [meta.faf_version, meta.scenario, meta.year, meta.data_version, meta.view, meta.direction, meta.dollar_basis];
  return toCsv(
    headers,
    rows.map((r) => [...m, ...dimKeys.map((k) => r[k]), ...measures.map((k) => r[k])]),
  );
}

export function exportFileName(meta: ExportMeta): string {
  return `faf_${meta.faf_version}_${meta.scenario}_${meta.year}_${meta.view}_${meta.direction}.csv`.replace(/[^A-Za-z0-9._-]+/g, '_');
}
