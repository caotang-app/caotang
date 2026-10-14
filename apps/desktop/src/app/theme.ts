/**
 * The light and dark theme ([ui-modules.md] §0.5: colours come from tokens, and the theme only
 * chooses which set of tokens is on).
 *
 * The choice is the writer's, kept in this browser's local storage under one key. With no choice
 * stored the page follows the operating system, which is what `styles.css` does on its own: the
 * attribute is set only for an explicit choice. A storage failure (a private window, blocked site
 * data) is not an error for the page, so every access is guarded and the theme then simply
 * follows the system for that visit.
 */

export type Theme = 'light' | 'dark';

export const THEME_KEY = 'caotang.theme';

/** The writer's stored choice, or `null` when there is none, or the store cannot be read. */
export function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

/** The theme in effect now: the explicit choice on the page, or the operating system's. */
export function activeTheme(): Theme {
  const explicit = document.documentElement.dataset['theme'];
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Put a choice on the page, or hand the page back to the operating system with `null`. */
export function applyTheme(theme: Theme | null): void {
  if (theme === null) {
    delete document.documentElement.dataset['theme'];
    return;
  }
  document.documentElement.dataset['theme'] = theme;
}

/** Remember a choice for the next visit. The page has already changed; a failed store only loses the memory. */
export function rememberTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Not kept, so the next visit follows the system. Nothing the writer typed depends on it.
  }
}

/** Applied once, before the first render, so the first paint already has the chosen colours. */
export function initTheme(): void {
  applyTheme(storedTheme());
}
