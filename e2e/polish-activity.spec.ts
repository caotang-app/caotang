import { expect, test } from '@playwright/test';

import { createProject } from './support.js';

/**
 * The activity panel's empty state names a next step (ui-modules §0.3: every empty surface carries one actionable next step), and the
 * step is the one that fills the panel: the first change made in the binder becomes its first row.
 */

test('an empty activity panel says what the next step is, and taking it fills the panel', async ({ page }) => {
  await createProject(page, 'Quiet Book');
  await page.getByRole('tab', { name: 'Activity' }).click();

  const empty = page.getByRole('region', { name: 'Nothing has changed yet' });
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('Next step: type a sentence in the editor, or make a folder in the binder');

  await page.getByRole('tab', { name: 'Binder' }).click();
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByRole('textbox', { name: 'Rename Untitled' }).fill('Act One');
  await page.keyboard.press('Enter');

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByRole('region', { name: 'Nothing has changed yet' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Activity' }).getByRole('listitem').first()).toBeVisible();
});
