import { expect, test } from '@playwright/test';

import { createProject, waitForSaved } from './support.js';

/**
 * epub-metadata.md's cover row, as the Project panel words it. A cover chosen in a browser is kept in that browser (the asset
 * store, storyboard.md §2.2), so it is still there after a reload, and the panel says so. A project saved to a folder keeps it
 * with the project. A cover whose image has gone is said so, rather than the panel saying a cover is set when the EPUB would
 * have none.
 */

/** A 1×1 PNG: the cover import checks the file's signature, and nothing else about it. */
const COVER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

test('a cover is kept in this browser, so it is still set after a reload, and the panel says so', async ({ page }) => {
  await createProject(page, 'Cover Tab');
  await page.getByRole('button', { name: 'Cover Tab' }).click();
  const panel = page.getByRole('dialog', { name: 'Project' });
  await panel.getByLabel('Cover image file').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: COVER_PNG });

  await expect(page.getByRole('status').filter({ hasText: 'The cover is set' })).toContainText('It is kept in this browser');
  await expect(panel).toContainText('It is kept in this browser');
  await panel.getByRole('button', { name: 'Done' }).click();
  await waitForSaved(page);

  // The project keeps its cover across a reload: the image is in the browser's copy, and the panel finds it there.
  await page.reload();
  await page.getByRole('listitem').filter({ hasText: 'Cover Tab' }).getByRole('button', { name: 'Open' }).click();
  // The projects screen stays up, with its buttons disabled, until the project has opened: wait for the binder first.
  await expect(page.getByRole('tree', { name: 'Binder' })).toBeVisible();
  await page.getByRole('button', { name: 'Cover Tab' }).click();
  const reopened = page.getByRole('dialog', { name: 'Project' });
  await expect(reopened).toContainText('A cover image is set and goes into EPUB files');
  await expect(reopened).not.toContainText('its image is not in this browser any more');
  await expect(reopened.getByRole('button', { name: 'Replace cover…' })).toBeVisible();
});
