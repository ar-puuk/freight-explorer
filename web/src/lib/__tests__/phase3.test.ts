import { describe, expect, it } from 'vitest';
import { csvCell, exportFileName, tableToCsv, toCsv } from '../csv';
import { compareSql, heatmapSql, modeTrendSql, partnerExpr, partnersSql, tableSql, trendSql, type FlowFilter } from '../sql';
import type { AppState } from '../types';
import { decode, encode, type Allowed } from '../urlstate';

const zones = ['991', '999'];
const f: FlowFilter = { view: 'total', direction: 'both', commodities: [], modes: [], measure: 'tons', dollars: 'const' };

describe('trend and chart queries', () => {
  it('trend groups by scenario and year and drops years where the measure is not published', () => {
    const q = trendSql('t_x', f, zones);
    expect(q).toContain('GROUP BY 1, 2 HAVING sum(tons_kt) IS NOT NULL');
    expect(q).toContain('scenario');
    expect(trendSql('t_x', { ...f, measure: 'tmiles' }, zones)).toContain('sum(tmiles_m)');
  });

  it('mode trend ignores the mode filter but keeps the others, mid-range only', () => {
    const q = modeTrendSql('t_x', { ...f, modes: [1], commodities: ['02'] }, zones);
    expect(q).not.toContain('dms_mode IN');
    expect(q).toContain("sctg2 IN ('02')");
    expect(q).toContain("scenario = 'mid'");
  });

  it('partner is the non-state end of the flow, by view', () => {
    expect(partnerExpr('total', zones)).toContain('THEN dms_orig');
    expect(partnerExpr('import', zones)).toContain('THEN fr_orig');
    expect(partnerExpr('export', zones)).toContain('THEN fr_dest');
    expect(partnersSql('r', f, zones, 7)).toMatch(/LIMIT 7$/);
    expect(partnersSql('r', f, zones)).toContain('partner IS NOT NULL');
  });

  it('compare builds one series per item and rejects non-codes', () => {
    const z = compareSql('t_x', f, zones, 'zone', ['011', '012']);
    expect(z).toContain("unnest(['011', '012'])");
    expect(z).toContain('(dms_orig = ids.item OR dms_dest = ids.item)');
    const c = compareSql('t_x', { ...f, commodities: ['02'] }, zones, 'commodity', ['15']);
    expect(c).toContain('sctg2 = ids.item');
    expect(c).not.toContain("sctg2 IN ('02')"); // comparing commodities ignores the commodity filter
    expect(() => compareSql('t_x', f, zones, 'zone', ["1'; --"])).toThrow();
    expect(() => compareSql('t_x', f, zones, 'commodity', ['123'])).toThrow();
  });

  it('table groups by the chosen dimensions and always returns all four measures', () => {
    const q = tableSql('r', { ...f, view: 'import' }, zones, ['orig', 'dest', 'dms_mode'], 100);
    expect(q).toContain('fr_orig AS origin');
    expect(q).toContain('dms_dest AS destination');
    expect(q).toContain('dms_mode AS domestic_mode');
    for (const m of ['tons_kt', 'value_const_musd', 'value_current_musd', 'tmiles_m']) expect(q).toContain(`sum(${m}) AS ${m}`);
    expect(q).toContain('GROUP BY 1, 2, 3');
    expect(q).toMatch(/LIMIT 100$/);
    expect(tableSql('r', f, zones, [], null)).not.toContain('GROUP BY');
    expect(tableSql('r', f, zones, ['bogus'], null)).not.toContain('bogus');
    expect(heatmapSql('r', f, zones)).toContain('GROUP BY 1, 2');
  });
});

describe('csv export', () => {
  it('quotes commas, quotes and line breaks; empty for null', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(NaN)).toBe('');
    expect(csvCell(0)).toBe('0'); // a real zero stays a zero
  });

  it('table export carries version, scenario, year, status, dollar basis and unit-bearing headers; NULL stays empty', () => {
    const meta = { faf_version: '5.7.1', scenario: 'high', year: 2030, data_version: 'forecast', view: 'total', direction: 'both', dollar_basis: 'constant 2017 dollars' };
    const csv = tableToCsv(meta, ['origin'], [{ origin: 'Salt Lake, UT', tons_kt: 12.5, value_const_musd: 40, value_current_musd: null, tmiles_m: null }], ['origin']);
    const [head, row] = csv.trim().split('\r\n');
    expect(head).toBe('faf_version,scenario,year,data_version,flow_view,direction,dollar_basis,origin,tons_thousand,value_constant_million_usd,value_current_million_usd,ton_miles_million');
    expect(row).toBe('5.7.1,high,2030,forecast,total,both,constant 2017 dollars,"Salt Lake, UT",12.5,40,,');
    expect(exportFileName(meta)).toBe('faf_5.7.1_high_2030_total_both.csv');
    expect(toCsv(['a'], [[1], [2]])).toBe('a\r\n1\r\n2\r\n');
  });
});

describe('scenario url state', () => {
  const defaults: AppState = {
    version: '5.7.1', scenario: 'mid', year: 2023, view: 'total', direction: 'both', measure: 'tons', dollars: 'const', commodities: [], modes: [],
    topN: 50, minFlow: 0, selected: null, layers: { flows: true, network: false, zones: true }, net: { year: 2017, truck: 'all', market: 'total', connectors: false },
    basemap: null, theme: 'system', cam: null, panel: 'closed', compare: { kind: 'zone', ids: [] }, overlayOther: false, tableDims: ['orig', 'dest', 'sctg2'],
  };
  const allowed: Allowed = {
    versions: ['5.7.1', '6.0'],
    scenarios: (v) => (v === '6.0' ? ['mid'] : ['mid', 'high', 'low']),
    years: (v, sc) => (sc === 'mid' ? (v === '6.0' ? [2022] : [2017, 2023, 2030, 2035]) : [2030, 2035]),
    defaultYear: (v) => (v === '6.0' ? 2022 : 2023),
    netYears: [2017, 2022, 2050],
  };
  const first = () => 2030;

  it('round-trips scenario, panel, compare items, overlay and table dimensions', () => {
    const s: AppState = { ...defaults, scenario: 'high', year: 2035, panel: 'compare', compare: { kind: 'commodity', ids: ['15', '02'] }, overlayOther: true, tableDims: ['dms_mode', 'orig'] };
    const url = encode(s, defaults, allowed.defaultYear, first);
    expect(url).toContain('sc=high');
    const back = decode(url, defaults, allowed);
    expect(back.scenario).toBe('high');
    expect(back.year).toBe(2035);
    expect(back.panel).toBe('compare');
    expect(back.compare).toEqual({ kind: 'commodity', ids: ['02', '15'] });
    expect(back.overlayOther).toBe(true);
    expect(back.tableDims).toEqual(['orig', 'dms_mode']); // canonical order
  });

  it('a scenario year that does not exist falls back to the first scenario year; unknown scenarios to mid', () => {
    expect(decode('?sc=high&y=2017', defaults, allowed).year).toBe(2030);
    expect(decode('?sc=bogus', defaults, allowed).scenario).toBe('mid');
    expect(decode('?v=6.0&sc=high', defaults, allowed).scenario).toBe('mid'); // FAF6 has no scenarios
  });

  it('the first scenario year is the default and gets a clean URL', () => {
    const s: AppState = { ...defaults, scenario: 'low', year: 2030 };
    expect(encode(s, defaults, allowed.defaultYear, first)).toBe('?sc=low');
  });
});
