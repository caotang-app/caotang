import { expect, test } from '@playwright/test';

import { binderRow, createProject } from './support.js';

/**
 * The rail's keyboard and focus behaviour (ui-modules §0.4): the rail tabs and the centre's radio group answer the arrow keys,
 * each tab names its panel, a menu gives focus back to the control that opened it, and the filter chord shows the binder
 * from any other rail. Each assertion is on what the keyboard user sees and where the focus is.
 */

test('the rail tabs answer the arrow keys, Home and End, and the panel is named by the tab that shows it', async ({ page }) => {
  await createProject(page, 'Rail Keys');
  await page.getByRole('tab', { name: 'Binder' }).focus();

  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Codex' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Codex' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'rail-tab-codex');
  await expect(page.getByRole('tabpanel')).toHaveAccessibleName('Codex');

  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Findings' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Findings' })).toHaveAttribute('aria-selected', 'true');

  // The end wraps to the start, and Home goes straight back to the first tab.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Binder' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Findings' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Binder' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Binder' })).toHaveAttribute('tabindex', '0');
  await expect(page.getByRole('tab', { name: 'Codex' })).toHaveAttribute('tabindex', '-1');
});

test('the centre view radio group moves with the arrow keys, and the view it selects is shown', async ({ page }) => {
  await createProject(page, 'Centre Keys');
  await page.getByRole('radio', { name: 'Editor' }).focus();

  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Corkboard' })).toBeFocused();
  await expect(page.getByRole('radio', { name: 'Corkboard' })).toHaveAttribute('aria-checked', 'true');

  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('radio', { name: 'Editor' })).toBeFocused();
  await expect(page.getByRole('radio', { name: 'Editor' })).toHaveAttribute('aria-checked', 'true');
});

test('a menu gives focus back to the control that opened it when it closes', async ({ page }) => {
  await createProject(page, 'Menu Focus');
  // A document goes inside a chapter, so the chapter is made first and New document puts the scene in it.
  await page.getByRole('button', { name: 'Create Chapter 1' }).click();
  await page.getByRole('toolbar', { name: 'Binder actions' }).getByRole('button', { name: 'New document' }).click();
  await page.getByRole('textbox', { name: 'Rename Untitled' }).fill('The Lamp');
  await page.keyboard.press('Enter');
  await expect(binderRow(page, 'The Lamp')).toBeVisible();

  const chip = binderRow(page, 'The Lamp').getByRole('button', { name: /^Status of The Lamp/ });
  await chip.click();
  await expect(page.getByRole('menuitemradio', { name: 'Revised' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitemradio', { name: 'Revised' })).toHaveCount(0);
  await expect(chip).toBeFocused();
});

test('Ctrl+Alt+F from the Codex rail shows the binder and focuses the filter field', async ({ page }) => {
  await createProject(page, 'Chord Rail');
  await page.getByRole('tab', { name: 'Codex' }).click();
  await expect(page.getByRole('tab', { name: 'Codex' })).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Control+Alt+F');
  await expect(page.getByRole('tab', { name: 'Binder' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('searchbox', { name: 'Filter the binder by text' })).toBeFocused();
});

test('Ctrl+Alt+F from focus mode leaves focus mode and focuses the filter field', async ({ page }) => {
  await createProject(page, 'Chord Focus');
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Filter the binder by text' })).toHaveCount(0);

  await page.keyboard.press('Control+Alt+F');
  await expect(page.getByRole('searchbox', { name: 'Filter the binder by text' })).toBeFocused();
});

/**
 * The filter bar is laid out inside the 264 px rail (binder-filters §5, ui-modules §1): no field in it reaches past the rail's right
 * edge, and the rail does not scroll sideways. The date windows were the widest fields, so they are measured too.
 */
for (const [width, height] of [
  [1280, 800],
  [1440, 900],
] as const) {
  test(`the binder's filter bar fits the rail at ${width} pixels wide, and no field reaches past its edge`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await createProject(page, `Filter Fit ${width}`);
    await expect(page.getByTestId('binder-filters')).toBeVisible();
    // The name is the visible label's words, so a voice user says what the writer reads (WCAG 2.5.3).
    await expect(page.getByRole('spinbutton', { name: 'Created in the last days' })).toBeVisible();

    const overflow = await page.evaluate(() => {
      const rail = document.querySelector('.rail-panel');
      const bar = document.querySelector('[data-testid="binder-filters"]');
      if (rail === null || bar === null) return ['the rail or the filter bar is missing'];
      const edge = rail.getBoundingClientRect().right;
      return [bar, ...Array.from(bar.querySelectorAll('*'))]
        .filter((element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().right > edge + 0.5)
        .map((element) => `${element.tagName.toLowerCase()}.${String(element.getAttribute('class') ?? '')}`);
    });
    expect(overflow).toEqual([]);
    const railScrolls = await page.locator('.rail-panel').evaluate((element) => element.scrollWidth > element.clientWidth + 1);
    expect(railScrolls).toBe(false);
  });
}
