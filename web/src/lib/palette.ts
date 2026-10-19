/** Okabe-Ito colorblind-safe palette, used where an unbounded number of items is compared (compare and history lines). Series are always also distinguished by label or position, never by color alone. */
export const OKABE_ITO = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#F0E442', '#999999'];

/** Domestic mode code -> design token. Codes 1 to 8 are the FAF modes; 11 is the county product's "truck and air". */
const MODE_TOKEN: Record<number, string> = { 1: '--k1', 2: '--k4', 3: '--k2', 4: '--k3', 5: '--k6', 6: '--k7', 7: '--k12', 8: '--k8', 11: '--k1' };

/** CSS value for markup (follows the theme with no redraw). */
export const modeVar = (code: number | string): string => `var(${MODE_TOKEN[Number(code)] ?? '--k8'})`;
export const groupVar = (i: number): string => `var(--k${(((i % 12) + 12) % 12) + 1})`;
export const DIR_VAR = { inbound: 'var(--in)', outbound: 'var(--out)', within: 'var(--within)' } as const;

/** Blend two #rrggbb colors; t = share of b. */
export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(a);
  const [r2, g2, b2] = p(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

const token = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Resolved color for SVG and canvas code that cannot use var() (Observable Plot scales). */
export const modeColor = (code: number | string): string => token(MODE_TOKEN[Number(code)] ?? '--k8');
export const groupColor = (i: number): string => token(`--k${(((i % 12) + 12) % 12) + 1}`);

export interface ChartColors {
  text: string;
  muted: string;
  grid: string;
  accent: string;
  surface: string;
  band: string;
  panel3: string;
  inbound: string;
  outbound: string;
  within: string;
}

/** Resolve the theme tokens to concrete colors for SVG (Plot does not read CSS variables reliably in every property). */
export function readColors(): ChartColors {
  const v = (name: string, fallback: string) => token(name) || fallback;
  return {
    text: v('--ink', '#0E1620'),
    muted: v('--ink-3', '#566474'),
    grid: v('--line-2', '#C6CFDA'),
    accent: v('--accent', '#2545D6'),
    surface: v('--panel', '#FFFFFF'),
    band: v('--accent', '#2545D6'),
    panel3: v('--panel-3', '#E9EDF2'),
    inbound: v('--in', '#0A8794'),
    outbound: v('--out', '#D26A12'),
    within: v('--within', '#6A78A0'),
  };
}
