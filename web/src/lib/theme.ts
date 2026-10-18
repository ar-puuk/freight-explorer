import type { ThemePref } from './types';

export type ResolvedTheme = 'light' | 'dark';

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === 'light' || pref === 'dark') return pref;
  return mq?.matches ? 'dark' : 'light';
}

export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

/** Calls back when the OS theme changes; the caller decides whether that matters (only when the preference is "system"). */
export function onSystemThemeChange(cb: () => void): () => void {
  mq?.addEventListener('change', cb);
  return () => mq?.removeEventListener('change', cb);
}

export function defaultBasemap(resolved: ResolvedTheme): string {
  return resolved === 'dark' ? 'dark' : 'positron';
}
