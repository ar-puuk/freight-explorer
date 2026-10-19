import { describe, expect, it } from 'vitest';
import { formatPercent, formatTons, formatTonMiles, formatValue, formatValuePerTon } from '../format';
import { balanceSql, breakdownSql, directionClause, endpoints, flowsSql, flowTotalsSql, measureColumn, whereClause, type FlowFilter } from '../sql';
import type { AppState } from '../types';
import { decode, encode, type Allowed } from '../urlstate';

const zones = ['991', '999'];
const base: FlowFilter = { view: 'total', direction: 'both', commodities: [], modes: [], measure: 'tons', dollars: 'const' };

describe('sql builders', () => {
  it('picks the measure column from measure and dollar basis', () => {
    expect(measureColumn('tons', 'current')).toBe('tons_kt');
    expect(measureColumn('value', 'const')).toBe('value_const_musd');
    expect(measureColumn('value', 'current')).toBe('value_current_musd');
    expect(measureColumn('tmiles', 'const')).toBe('tmiles_m');
  });

  it('uses foreign regions as arc endpoints in import and export views', () => {
    expect(endpoints('total')).toEqual({ o: 'dms_orig', d: 'dms_dest' });
    expect(endpoints('import')).toEqual({ o: 'fr_orig', d: 'dms_dest' });
    expect(endpoints('export')).toEqual({ o: 'dms_orig', d: 'fr_dest' });
  });

  it('defines direction on the domestic leg', () => {
    expect(directionClause('both', zones)).toBeNull();
    expect(directionClause('inbound', zones)).toBe("(dms_dest IN ('991', '999') AND dms_orig NOT IN ('991', '999'))");
    expect(directionClause('outbound', zones)).toContain("dms_orig IN ('991', '999') AND dms_dest NOT IN");
    expect(directionClause('within', zones)).toBe("(dms_orig IN ('991', '999') AND dms_dest IN ('991', '999'))");
  });

  it('combines view, direction, commodity and mode filters', () => {
    const w = whereClause({ ...base, view: 'import', direction: 'inbound', commodities: ['02', '15'], modes: [1, 2] }, zones);
    expect(w).toContain('trade_type = 2');
    expect(w).toContain("sctg2 IN ('02', '15')");
    expect(w).toContain('dms_mode IN (1, 2)');
    expect(whereClause(base, zones)).toBe('TRUE');
  });

  it('rejects anything that is not a code (no SQL from the URL)', () => {
    expect(() => whereClause({ ...base, commodities: ["01'; DROP TABLE x;--"] }, zones)).toThrow();
    expect(() => whereClause({ ...base, modes: [1.5] }, zones)).toThrow();
    expect(() => flowsSql('t', base, zones, 10, 0, "999' OR '1'='1")).toThrow();
    expect(() => directionClause('inbound', ["9'9"])).toThrow();
  });

  it('builds the top-N flow query with the threshold and optional selection', () => {
    const q = flowsSql("read_parquet('f')", base, zones, 50, 12, '991');
    expect(q).toContain('sum(tons_kt) AS magnitude');
    expect(q).toContain('HAVING sum(tons_kt) > 12');
    expect(q).toContain("(dms_orig = '991' OR dms_dest = '991')");
    expect(q).toMatch(/LIMIT 50$/);
    expect(flowsSql('t', base, zones, null, 0)).not.toContain('LIMIT');
    expect(flowTotalsSql('t', base, zones, 0)).toContain('count(*)');
  });

  it('balance ignores the direction filter but keeps the others', () => {
    const q = balanceSql('t', { ...base, direction: 'inbound', modes: [3] }, zones);
    expect(q).toContain('dms_mode IN (3)');
    expect(q).not.toContain('NOT IN');
    expect(breakdownSql('t', base, zones, 'sctg2', null)).toContain('GROUP BY 1');
  });
});

describe('formatting', () => {
  it('scales thousand tons, million dollars and million ton-miles', () => {
    expect(formatTons(850)).toBe('850 thousand tons');
    expect(formatTons(12_300)).toBe('12.3 million tons');
    expect(formatTons(2_500_000)).toBe('2.5 billion tons');
    expect(formatTonMiles(4_200)).toBe('4.2 billion ton-miles');
    expect(formatValue(410_679, 'const', 2022)).toBe('$411 billion (2022 dollars)');
    expect(formatValue(500, 'current', 2017)).toBe('$500 million (current dollars)');
    expect(formatValuePerTon(2000, 1000)).toBe('$2,000 per ton');
  });
  it('says "not published" rather than 0 for missing values', () => {
    expect(formatTons(null)).toBe('not published');
    expect(formatTonMiles(undefined)).toBe('not published');
    expect(formatValuePerTon(null, 5)).toBe('not published');
  });
  it('formats percentages', () => {
    expect(formatPercent(0.5)).toBe('50%');
    expect(formatPercent(0.034)).toBe('3.4%');
    expect(formatPercent(1)).toBe('100%');
  });
});

describe('url state', () => {
  const defaults: AppState = {
    version: '5.7.1', scenario: 'mid', year: 2023, view: 'total', direction: 'both', measure: 'tons', dollars: 'const',
    commodities: [], modes: [], topN: 50, minFlow: 0, selected: null,
    layers: { flows: true, network: false, zones: true }, net: { year: 2017, truck: 'all', market: 'total', connectors: false },
    basemap: null, theme: 'system', cam: null, panel: 'closed', compare: { kind: 'zone', ids: [] }, overlayOther: false, historyOverlay: false,
    tableDims: ['orig', 'dest', 'sctg2'], partner: null, compareMode: 'series', cmpA: 2017, cmpB: 2023,
  };
  const years: Record<string, number[]> = { '5.7.1': [2017, 2018, 2023, 2024, 2030, 2035], '6.0': [2022] };
  const scen: Record<string, number[]> = { high: [2030, 2035], low: [2030, 2035] };
  const allowed: Allowed = {
    versions: ['5.7.1', '6.0'],
    scenarios: (v) => (v === '6.0' ? ['mid'] : ['mid', 'high', 'low']),
    years: (v, sc) => (sc === 'mid' ? years[v] : scen[sc]),
    defaultYear: (v) => (v === '6.0' ? 2022 : 2023),
    netYears: [2017, 2022, 2050],
  };
  const firstScenarioYear = () => 2030;

  it('default state has a clean URL', () => {
    expect(encode(defaults, defaults, allowed.defaultYear, firstScenarioYear)).toBe('');
    expect(decode('', defaults, allowed)).toEqual(defaults);
  });

  it('round-trips a non-default state', () => {
    const s: AppState = {
      ...defaults, version: '6.0', year: 2022, view: 'import', direction: 'inbound', measure: 'value', dollars: 'current',
      commodities: ['15', '02'], modes: [2, 1], topN: 120, minFlow: 25.5, selected: '011',
      layers: { flows: true, network: true, zones: false }, net: { year: 2050, truck: 'cu', market: 'import', connectors: true },
      basemap: 'dark', theme: 'dark', cam: [-111.9, 40.7, 7.25],
    };
    const url = encode(s, defaults, allowed.defaultYear, firstScenarioYear);
    const back = decode(url, defaults, allowed);
    expect(back).toEqual({ ...s, commodities: ['02', '15'], modes: [1, 2] });
  });

  it('ignores invalid values instead of failing', () => {
    const s = decode('?v=9.9&y=1850&view=bogus&dir=up&m=x&top=-4&min=abc&com=zz,02&mode=0,9,3&sel=12&nt=hover&bm=nope&c=1,2', defaults, allowed);
    expect(s.version).toBe('5.7.1');
    expect(s.year).toBe(2023);
    expect(s.view).toBe('total');
    expect(s.direction).toBe('both');
    expect(s.measure).toBe('tons');
    expect(s.topN).toBe(5);
    expect(s.minFlow).toBe(0);
    expect(s.commodities).toEqual(['02']);
    expect(s.modes).toEqual([3]);
    expect(s.selected).toBeNull();
    expect(s.net.truck).toBe('all');
    expect(s.basemap).toBeNull();
    expect(s.cam).toBeNull();
  });

  it('switching version falls back to that version\'s default year', () => {
    expect(decode('?v=6.0', defaults, allowed).year).toBe(2022);
  });

  it('an empty layer list means all layers off', () => {
    const s = decode('?l=', defaults, allowed);
    expect(s.layers).toEqual({ flows: false, network: false, zones: false });
  });
});
