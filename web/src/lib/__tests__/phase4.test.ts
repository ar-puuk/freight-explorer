import { describe, expect, it } from 'vitest';
import { compareSql, directionClause, flowsSql, historyCommoditiesSql, historyModeSql, historyPartnerExpr, historyPartnersSql, historyTrendSql, historyWhere, whereClause, type FlowFilter } from '../sql';
import { decode, encode, type Allowed } from '../urlstate';
import type { AppState } from '../types';

const f: FlowFilter = { view: 'total', direction: 'both', commodities: [], modes: [], measure: 'tons', dollars: 'const' };

describe('history (state level) queries', () => {
  it('direction is relative to the state FIPS on the state columns', () => {
    expect(historyWhere(f, '99')).toBe('TRUE');
    expect(historyWhere({ ...f, direction: 'inbound' }, '99')).toBe("(dms_dest_st = '99' AND dms_orig_st <> '99')");
    expect(historyWhere({ ...f, direction: 'outbound' }, '99')).toBe("(dms_orig_st = '99' AND dms_dest_st <> '99')");
    expect(historyWhere({ ...f, direction: 'within' }, '99')).toBe("(dms_orig_st = '99' AND dms_dest_st = '99')");
  });

  it('applies view, commodity and mode filters like the zone-level queries', () => {
    const w = historyWhere({ ...f, view: 'export', commodities: ['02'], modes: [3] }, '99');
    expect(w).toContain('trade_type = 3');
    expect(w).toContain("sctg2 IN ('02')");
    expect(w).toContain('dms_mode IN (3)');
  });

  it('rejects anything that is not a code', () => {
    expect(() => historyWhere(f, "99' OR '1'='1")).toThrow();
    expect(() => historyWhere({ ...f, commodities: ["1'"] }, '99')).toThrow();
    expect(() => historyPartnerExpr('total', '9')).toThrow();
  });

  it('trend groups by year; mode chart ignores the mode filter; commodity chart ignores the commodity filter', () => {
    expect(historyTrendSql('t_history', f, '99')).toContain('GROUP BY 1 HAVING sum(tons_kt) IS NOT NULL');
    expect(historyModeSql('t_history', { ...f, modes: [1] }, '99')).not.toContain('dms_mode IN');
    expect(historyCommoditiesSql('t_history', { ...f, commodities: ['02'] }, '99', 5)).not.toContain('sctg2 IN');
    expect(historyCommoditiesSql('t_history', f, '99', 5)).toContain('LIMIT 5');
  });

  it('partners are states, or foreign regions in the import and export views', () => {
    expect(historyPartnerExpr('total', '99')).toContain('THEN dms_orig_st');
    expect(historyPartnerExpr('import', '99')).toContain('THEN fr_orig');
    expect(historyPartnerExpr('export', '99')).toContain('THEN fr_dest');
    const q = historyPartnersSql('t_history', f, '99', 6);
    expect(q).toContain('top AS');
    expect(q).toContain('LIMIT 6');
  });
});

describe('county-product ids and codes', () => {
  const counties = ['99001', '99002'];

  it('5-digit county ids and county commodity groups are accepted; other shapes are not', () => {
    expect(directionClause('inbound', counties)).toContain("dms_dest IN ('99001', '99002')");
    expect(whereClause({ ...f, commodities: ['sctg0109', 'sctg3499'] }, counties)).toContain("sctg2 IN ('sctg0109', 'sctg3499')");
    expect(flowsSql('t', f, counties, 10, 0, '99001')).toContain("dms_orig = '99001'");
    expect(compareSql('t', f, counties, 'zone', ['99001', '99002'])).toContain("unnest(['99001', '99002'])");
    expect(() => whereClause({ ...f, commodities: ['sctg01'] }, counties)).toThrow();
    expect(() => directionClause('inbound', ['9900'])).toThrow();
    expect(() => flowsSql('t', f, counties, 10, 0, '9900')).toThrow();
  });
});

describe('url state for the history tab and the county version', () => {
  const defaults: AppState = {
    version: '5.7.1', scenario: 'mid', year: 2023, view: 'total', direction: 'both', measure: 'tons', dollars: 'const', commodities: [], modes: [],
    topN: 50, minFlow: 0, selected: null, layers: { flows: true, network: false, zones: true }, net: { year: 2017, truck: 'all', market: 'total', connectors: false },
    basemap: null, theme: 'system', cam: null, panel: 'closed', compare: { kind: 'zone', ids: [] }, overlayOther: false, historyOverlay: false, tableDims: ['orig', 'dest', 'sctg2'], partner: null, compareMode: 'series', cmpA: 2017, cmpB: 2023,
  };
  const allowed: Allowed = {
    versions: ['5.7.1', '6.0', 'county-exp'],
    scenarios: (v) => (v === '5.7.1' ? ['mid', 'high', 'low'] : ['mid']),
    years: (v, sc) => (sc !== 'mid' ? [2030] : v === '5.7.1' ? [2017, 2023, 2030] : [2022]),
    defaultYear: (v) => (v === '5.7.1' ? 2023 : 2022),
    netYears: [2017, 2022, 2050],
  };

  it('round-trips the history panel with its overlay', () => {
    const s: AppState = { ...defaults, panel: 'history', historyOverlay: true };
    const url = encode(s, defaults, allowed.defaultYear);
    expect(url).toContain('panel=history');
    expect(url).toContain('ho=1');
    const back = decode(url, defaults, allowed);
    expect(back.panel).toBe('history');
    expect(back.historyOverlay).toBe(true);
  });

  it('the county version is a normal selectable version with its own single year', () => {
    const s = decode('?v=county-exp', defaults, allowed);
    expect(s.version).toBe('county-exp');
    expect(s.year).toBe(2022);
    expect(encode(s, defaults, allowed.defaultYear)).toBe('?v=county-exp');
  });
});
