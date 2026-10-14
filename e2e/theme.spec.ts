import { expect, test, type Page } from '@playwright/test';

import { createProject } from './support.js';

/**
 * The theme (app/theme.ts): a writer's light or dark choice, kept in this browser, applied before the first
 * paint, and the page's colours follow it. With no choice the page follows the operating system.
 *
 * The code inside `page.evaluate` is sent to the page as text, so each callback names its own globals, and
 * reads the DOM through `globalThis` as `support.ts` does: this package's tsconfig has no DOM library.
 */

/** The page's background, as the browser computes it: the one number that changes with the theme. */
function background(page: Page): Promise<string> {
  return page.evaluate(() => {
    const view = globalThis as unknown as {
      document: { body: unknown };
      getComputedStyle(element: unknown): { backgroundColor: string };
    };
    return view.getComputedStyle(view.document.body).backgroundColor;
  });
}

/** The theme attribute on the root element, or `null` when the page follows the system. */
function themeAttribute(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const view = globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } };
    return view.document.documentElement.dataset['theme'] ?? null;
  });
}

/** The stored choice, as this browser keeps it. */
function storedChoice(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const view = globalThis as unknown as { localStorage: { getItem(key: string): string | null } };
    return view.localStorage.getItem('caotang.theme');
  });
}

test('the theme toggle changes the page to dark, remembers the choice, and the choice survives a reload', async ({
  page,
}) => {
  await createProject(page, 'Theme Book');
  const light = await background(page);
  expect(await themeAttribute(page)).toBeNull();

  await page.getByRole('button', { name: 'Dark theme' }).click();
  await expect(page.getByRole('button', { name: 'Light theme' })).toBeVisible();
  expect(await themeAttribute(page)).toBe('dark');
  expect(await background(page)).not.toBe(light);
  expect(await storedChoice(page)).toBe('dark');

  await page.reload();
  // Applied before the first paint: the projects screen already has the dark choice.
  await expect(page.getByRole('heading', { name: 'Projects in this browser' })).toBeVisible();
  expect(await themeAttribute(page)).toBe('dark');
  expect(await background(page)).not.toBe(light);
});

test('a light choice is kept too, and the editor column keeps its measure', async ({ page }) => {
  await createProject(page, 'Measure Book');
  await page.getByRole('button', { name: 'Dark theme' }).click();
  await page.getByRole('button', { name: 'Light theme' }).click();
  expect(await storedChoice(page)).toBe('light');
  expect(await themeAttribute(page)).toBe('light');

  await page.getByRole('button', { name: 'Create Chapter 1' }).click();
  await page.getByRole('toolbar', { name: 'Binder actions' }).getByRole('button', { name: 'New document' }).click();
  await page.getByRole('textbox', { name: 'Rename Untitled' }).fill('Measured');
  await page.keyboard.press('Enter');

  // About 66 characters: the column is no wider than 66 zeros in the serif the manuscript is set in.
  const widths = await page.evaluate(() => {
    interface Element {
      readonly style: { fontFamily: string; fontSize: string; whiteSpace: string };
      textContent: string;
      appendChild(child: Element): Element;
      getBoundingClientRect(): { readonly width: number };
      remove(): void;
    }
    const view = globalThis as unknown as {
      document: { querySelector(selector: string): Element; createElement(tag: string): Element };
      getComputedStyle(element: unknown): { fontFamily: string; fontSize: string };
    };
    const column = view.document.querySelector('.editor-column');
    const font = view.getComputedStyle(column);
    const probe = view.document.createElement('span');
    probe.style.fontFamily = font.fontFamily;
    probe.style.fontSize = font.fontSize;
    probe.style.whiteSpace = 'pre';
    probe.textContent = '0'.repeat(66);
    column.appendChild(probe);
    const measure = probe.getBoundingClientRect().width;
    probe.remove();
    return { column: column.getBoundingClientRect().width, measure };
  });
  expect(widths.column).toBeLessThanOrEqual(widths.measure + 1);
});
