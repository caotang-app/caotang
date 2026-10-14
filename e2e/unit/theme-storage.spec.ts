import { expect, test } from '@playwright/test';

import {
  THEME_KEY,
  activeTheme,
  applyTheme,
  rememberTheme,
  storedTheme,
} from '../../apps/desktop/src/app/theme.js';

/**
 * The theme reads two browser globals, `window` (storage, the system's colour preference) and `document` (the
 * attribute). These tests stand in for them, and put the originals back when they finish.
 */
interface Stubs {
  readonly storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  readonly systemDark: boolean;
}

function withBrowser(stubs: Stubs, body: (dataset: Record<string, string>) => void): void {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = { window: globals['window'], document: globals['document'] };
  const dataset: Record<string, string> = {};
  globals['window'] = {
    localStorage: stubs.storage,
    matchMedia: () => ({ matches: stubs.systemDark }),
  };
  globals['document'] = { documentElement: { dataset } };
  try {
    body(dataset);
  } finally {
    globals['window'] = previous.window;
    globals['document'] = previous.document;
  }
}

function memory(initial: Record<string, string> = {}): Stubs['storage'] & { readonly values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

test('the stored choice is read back, and anything else is no choice at all', () => {
  withBrowser({ storage: memory({ [THEME_KEY]: 'dark' }), systemDark: false }, () => {
    expect(storedTheme()).toBe('dark');
  });
  withBrowser({ storage: memory({ [THEME_KEY]: 'sepia' }), systemDark: false }, () => {
    expect(storedTheme()).toBeNull();
  });
  withBrowser({ storage: memory(), systemDark: false }, () => {
    expect(storedTheme()).toBeNull();
  });
});

test('a browser that refuses its storage is no error: the page follows the system for that visit', () => {
  const refusing = {
    getItem: () => {
      throw new Error('storage is blocked for this site');
    },
    setItem: () => {
      throw new Error('storage is blocked for this site');
    },
  };
  withBrowser({ storage: refusing, systemDark: true }, (dataset) => {
    expect(storedTheme()).toBeNull();
    expect(() => rememberTheme('light')).not.toThrow();
    applyTheme(null);
    expect(dataset['theme']).toBeUndefined();
    expect(activeTheme()).toBe('dark');
  });
});

test('an explicit choice on the page wins over the system, and clearing it hands the page back to the system', () => {
  withBrowser({ storage: memory(), systemDark: true }, (dataset) => {
    expect(activeTheme()).toBe('dark');
    applyTheme('light');
    expect(dataset['theme']).toBe('light');
    expect(activeTheme()).toBe('light');
    applyTheme(null);
    expect(dataset['theme']).toBeUndefined();
    expect(activeTheme()).toBe('dark');
  });
});

test('a choice is remembered under one key, for the next visit', () => {
  const storage = memory();
  withBrowser({ storage, systemDark: false }, () => {
    rememberTheme('dark');
  });
  expect(storage.values.get(THEME_KEY)).toBe('dark');
});
