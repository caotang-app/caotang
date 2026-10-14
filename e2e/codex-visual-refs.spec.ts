import { expect, test } from '@playwright/test';

import { createProject, waitForSaved } from './support.js';

/**
 * A codex entry's visual references (video-prompt-pack.md §3, A5): a picture the project holds, chosen in the entry's editor, kept with
 * the entry through a reload, and taken off again. The picture is the project's cover, which the Project panel keeps in the project's
 * `assets/` folder, so it is one of the pictures the picker lists.
 */

/** A 1×1 PNG: the cover import checks the file's signature, and nothing else about it. */
const COVER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

test('a picture of the project is chosen as a visual reference, kept through a reload, and taken off again', async ({ page }) => {
  await createProject(page, 'Picture Book');
  await page.getByRole('button', { name: 'Picture Book' }).click();
  const project = page.getByRole('dialog', { name: 'Project' });
  await project.getByLabel('Cover image file').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: COVER_PNG });
  await project.getByRole('button', { name: 'Done' }).click();
  await waitForSaved(page);

  await page.getByRole('tab', { name: 'Codex' }).click();
  await page.getByRole('button', { name: 'New entry' }).click();
  const name = page.getByRole('textbox', { name: 'Name' });
  await name.fill('Elena');
  await name.press('Enter');

  // Nothing is chosen yet; the picker offers the project's picture, and choosing it makes it a reference.
  const chosen = page.getByRole('list', { name: 'Chosen pictures' });
  await expect(chosen).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Add a picture' }).selectOption({ index: 1 });
  await expect(chosen.locator('li')).toHaveCount(1);
  await expect(chosen.locator('li')).toContainText('.png');
  await waitForSaved(page);

  // The entry keeps its reference across a reload.
  await page.reload();
  await page.getByRole('listitem').filter({ hasText: 'Picture Book' }).getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('tree', { name: 'Binder' })).toBeVisible();
  await page.getByRole('tab', { name: 'Codex' }).click();
  await page.getByRole('button', { name: /^Elena/ }).click();
  await expect(page.getByRole('list', { name: 'Chosen pictures' }).locator('li')).toHaveCount(1);

  // Taking it off removes the reference, and the picker offers the picture again.
  await page.getByRole('list', { name: 'Chosen pictures' }).getByRole('button', { name: /^Remove / }).click();
  await expect(page.getByRole('list', { name: 'Chosen pictures' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Add a picture' })).toBeVisible();
});
