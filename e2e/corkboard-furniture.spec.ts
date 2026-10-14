import { expect, test } from '@playwright/test';

import { createProject } from './support.js';

/**
 * The corkboard's manuscript board (ui-modules §2.4, §3.2): the manuscript's children are chapters, so a card made on the
 * manuscript board is a chapter. A scene made there would sit directly under the manuscript, with no chapter to belong to.
 */
test('New card on the manuscript board makes a chapter, and never a scene directly under the manuscript', async ({ page }) => {
  await createProject(page, 'Board Book');
  await page.locator('.row.is-section', { hasText: 'Manuscript' }).click();
  await expect(page.locator('.corkboard-head .crumbs li')).toHaveText(['Manuscript']);

  await page.locator('.corkboard-head').getByRole('button', { name: 'New card' }).click();

  // The new item is a container: the binder gives a folder a collapse toggle, and a scene has none.
  await expect(page.getByRole('button', { name: 'Collapse Untitled' })).toBeVisible();
});
