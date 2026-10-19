import { describe, expect, it } from 'vitest';
import { formatBig, formatShort, percentChange } from '../format';
import { mix } from '../palette';
import {
  commodityTrendSql, compareYearsSql, directionTrendSql, historyWhere, partnerBreakdownSql, partnerClause, partnerKey, whereClause, zoneTotalsSql, type FlowFilter,
} from '../sql';
import type { AppState } from '../types';
import { timelineColumns } from '../ui';
import { decode, encode, type Allowed } from '../urlstate';

const zones = ['991', '999'];
const f: FlowFilter = { view: 'total', direction: 'both', commodities: [], modes: [], measure: 'tons', dollars: 'const' };

describe('partner filter and charts (the redesign)', () => {
  it('a partner is a state in the domestic views and a region in import and export', () => {
    expect(partnerKey('total', zones)).toContain('substr(');
    expect(partnerKey('domestic', zones)).toContain('substr(');
    expect(partnerKey('import', zones)).not.toContain('substr(');
    expect(partnerKey('export', zones)).toContain('fr_dest');
    expect(partnerClause('total', zones, '56')).toMatch(/= '56'$/);
    expect(partnerClause('import', zones, '801')).toMatch(/= '801'$/);
  });

  it('applies the partner filter everywhere the other filters apply, unless a chart asks to ignore it', () => {
    const w = whereClause({ ...f, partner: '56' }, zones);
    expect(w).toContain("= '56'");
    expect(whereClause({ ...f, partner: '56' }, zones, { ignorePartner: true })).toBe('TRUE');
    expect(whereClause(f, zones)).toBe('TRUE');
  });

  it('rejects anything that is not a partner code (no SQL from the URL)', () => {
    expect(() => partnerClause('total', zones, "56' OR '1'='1")).toThrow();
    expect(() => whereClause({ ...f, partner: '5' }, zones)).toThrow();
    expect(() => historyWhere({ ...f, partner: "x'" }, '99')).toThrow();
  });

  it('the history query keeps the partner filter at state level', () => {
    expect(historyWhere({ ...f, partner: '56' }, '99')).toContain("= '56'");
    expect(historyWhere({ ...f, view: 'import', partner: '801' }, '99')).toContain('fr_orig');
  });

  it('partner breakdown limits to the largest partners, splits by direction and commodity, and ignores the partner filter', () => {
    const q = partnerBreakdownSql('t', { ...f, partner: '56', modes: [1] }, zones, 14);
    expect(q).toContain('LIMIT 14');
    expect(q).toContain("'inbound'");
    expect(q).toContain('dms_mode IN (1)');
    expect(q).not.toContain("= '56'");
  });

  it('direction over time ignores the direction filter and groups by scenario and year', () => {
    const q = directionTrendSql('t_x', { ...f, direction: 'inbound', modes: [2] }, zones);
    expect(q).toContain("'within'");
    expect(q).toContain('dms_mode IN (2)');
    expect(q).toContain('GROUP BY 1, 2, 4');
  });

  it('commodity by year is mid-range and ignores the commodity filter', () => {
    const q = commodityTrendSql('t_x', { ...f, commodities: ['02'] }, zones);
    expect(q).toContain("scenario = 'mid'");
    expect(q).not.toContain('sctg2 IN');
  });

  it('two-year comparison tags the sides, keeps the other filters and rejects bad input', () => {
    const q = compareYearsSql('t_x', { ...f, commodities: ['02'], modes: [1] }, zones, 'sctg2', { year: 2017, scenario: 'mid' }, { year: 2040, scenario: 'high' });
    expect(q).toContain("year = 2017 AND scenario = 'mid'");
    expect(q).toContain("year = 2040 AND scenario = 'high'");
    expect(q).toContain('dms_mode IN (1)');
    expect(q).not.toContain('sctg2 IN');
    expect(() => compareYearsSql('t', f, zones, 'sctg2', { year: 2017, scenario: "mid'" }, { year: 2020, scenario: 'mid' })).toThrow();
    expect(() => compareYearsSql('t', f, zones, 'dms_mode', { year: 2017.5, scenario: 'mid' }, { year: 2020, scenario: 'mid' })).toThrow();
  });

  it('zone totals sum the measure by the non-state end of each flow', () => {
    const q = zoneTotalsSql('t', f, zones);
    expect(q).toContain('partner IS NOT NULL');
    expect(q).toContain('GROUP BY 1');
  });
});

describe('compact number forms', () => {
  it('short chart forms', () => {
    expect(formatShort('tons', 223_000)).toBe('223M');
    expect(formatShort('tons', 845)).toBe('845K');
    expect(formatShort('tons', 1_500_000)).toBe('1.5B');
    expect(formatShort('value', 248_000)).toBe('$248B');
    expect(formatShort('tmiles', 89_000)).toBe('89B');
    expect(formatShort('tons', null)).toBe('n/a');
  });
  it('headline forms carry a unit word and say "not published" for missing values', () => {
    expect(formatBig('tons', 223_400)).toEqual({ n: '223', u: 'million tons' });
    expect(formatBig('value', 248_100)).toEqual({ n: '$248', u: 'billion' });
    expect(formatBig('tmiles', 12.4)).toEqual({ n: '12', u: 'million' });
    expect(formatBig('tons', null)).toEqual({ n: 'n/a', u: 'not published' });
  });
  it('percent change needs a real base', () => {
    expect(percentChange(110, 100)).toBeCloseTo(10);
    expect(percentChange(90, 100)).toBeCloseTo(-10);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(null, 100)).toBeNull();
    expect(percentChange(5, undefined)).toBeNull();
  });
  it('blends colors', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#ff0000', '#ff0000', 0.3)).toBe('#ff0000');
  });
});

describe('timeline columns', () => {
  it('puts one hatched gap column where the release jumps from annual years to sparse forecasts', () => {
    const cols = timelineColumns([2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2030, 2035, 2040, 2045, 2050]);
    expect(cols.filter((c) => c.kind === 'gap')).toHaveLength(1);
    const gap = cols.findIndex((c) => c.kind === 'gap');
    expect(cols[gap - 1].year).toBe(2024);
    expect(cols[gap + 1].year).toBe(2030);
    expect(cols[gap].label).toBe('2025–29');
    expect(cols.filter((c) => c.kind === 'year')).toHaveLength(13);
  });
  it('adds no gap for evenly spaced forecast years, or for a single year', () => {
    expect(timelineColumns([2030, 2035, 2040]).every((c) => c.kind === 'year')).toBe(true);
    expect(timelineColumns([2022])).toEqual([{ kind: 'year', year: 2022, label: '2022' }]);
  });
});

describe('url state: partner, compare mode and years', () => {
  const defaults: AppState = {
    version: '5.7.1', scenario: 'mid', year: 2023, view: 'total', direction: 'both', measure: 'tons', dollars: 'const',
    commodities: [], modes: [], topN: 50, minFlow: 0, selected: null, partner: null,
    layers: { flows: true, network: false, zones: true }, net: { year: 2017, truck: 'all', market: 'total', connectors: false },
    basemap: null, theme: 'system', cam: null, panel: 'summary', compare: { kind: 'zone', ids: [] }, overlayOther: false, historyOverlay: false,
    tableDims: ['orig', 'dest', 'sctg2'], compareMode: 'series', cmpA: 2017, cmpB: 2023,
  };
  const allowed: Allowed = {
    versions: ['5.7.1', '6.0'],
    scenarios: (v) => (v === '6.0' ? ['mid'] : ['mid', 'high', 'low']),
    years: (v, sc) => (v === '6.0' ? [2022] : sc === 'mid' ? [2017, 2018, 2023, 2024, 2030, 2035] : [2030, 2035]),
    defaultYear: (v) => (v === '6.0' ? 2022 : 2023),
    netYears: [2017, 2022, 2050],
  };

  it('keeps the default view URL clean with the drawer open by default', () => {
    expect(encode(defaults, defaults, allowed.defaultYear, () => 2030)).toBe('');
    expect(decode('', defaults, allowed)).toEqual(defaults);
  });

  it('round-trips a partner, a closed drawer, the partners tab and two-year compare', () => {
    const s: AppState = { ...defaults, partner: '56', panel: 'partners', compareMode: 'years', cmpA: 2018, cmpB: 2035 };
    const url = encode(s, defaults, allowed.defaultYear, () => 2030);
    expect(url).toContain('pt=56');
    expect(url).toContain('panel=partners');
    expect(decode(url, defaults, allowed)).toEqual(s);
    const closed = encode({ ...defaults, panel: 'closed' }, defaults, allowed.defaultYear, () => 2030);
    expect(closed).toBe('?panel=closed');
    expect(decode(closed, defaults, allowed).panel).toBe('closed');
  });

  it('ignores a malformed partner or compare mode', () => {
    const s = decode('?pt=5x&cm=bogus&ca=abc&panel=nope', defaults, allowed);
    expect(s.partner).toBeNull();
    expect(s.compareMode).toBe('series');
    expect(s.cmpA).toBe(2017);
    expect(s.panel).toBe('summary');
  });
});
