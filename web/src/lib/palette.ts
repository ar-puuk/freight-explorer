/** Okabe-Ito colorblind-safe palette. Series are always also distinguished by label, symbol or position, never by color alone. */
export const OKABE_ITO = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#F0E442', '#999999'];

/** Domestic mode codes 1..8 -> a stable color. */
export const modeColor = (code: number | string): string => OKABE_ITO[(Number(code) - 1 + OKABE_ITO.length) % OKABE_ITO.length];

export interface ChartColors {
  text: string;
  muted: string;
  grid: string;
  accent: string;
  surface: string;
  band: string;
}

/** Resolve the theme tokens to concrete colors for SVG (Plot does not read CSS variables reliably in every property). */
export function readColors(): ChartColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    text: v('--text', '#1c2530'),
    muted: v('--text-muted', '#4a5663'),
    grid: v('--border', '#cfd6de'),
    accent: v('--accent', '#0b6a94'),
    surface: v('--surface', '#ffffff'),
    band: v('--accent', '#0b6a94'),
  };
}
