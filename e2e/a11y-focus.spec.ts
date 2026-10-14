import { expect, test } from '@playwright/test';

import { createProject } from './support.js';

/**
 * Focus goes back where it came from (ui-modules §0.4): Settings is a dialog opened from the toolbar, and when it closes, by its
 * Close button or by Escape, the keyboard is on the button that opened it. The shared Menu and ExportDialog do the same
 * (furniture-rail.spec.ts covers the Menu).
 */

test('Close returns focus to the Settings button that opened the dialog', async ({ page }) => {
  await createProject(page, 'Settings Focus');
  const opener = page.getByRole('button', { name: 'Settings', exact: true });
  await opener.click();

  const settings = page.getByTestId('settings');
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(settings).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('Escape closes Settings, and focus returns to the Settings button that opened it', async ({ page }) => {
  await createProject(page, 'Settings Escape');
  const opener = page.getByRole('button', { name: 'Settings', exact: true });
  await opener.click();

  await expect(page.getByTestId('settings')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings')).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('a dialog opened from the projects screen gives focus back to its own Settings button', async ({ page }) => {
  await page.goto('/');
  const opener = page.getByRole('button', { name: 'Settings', exact: true });
  await opener.click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('settings').getByRole('button', { name: 'Close' }).click();
  await expect(opener).toBeFocused();
});
