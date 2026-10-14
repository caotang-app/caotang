import { expect, test } from '@playwright/test';

import { createProject, waitForSaved } from './support.js';

/**
 * command-bus.md §8: the activity log holds one row per executed command. The panel shows those rows with a
 * person's title for each, newest first, the source they came from, and an Undo for each undo group.
 */

test('the activity panel lists the commands of a scripted session, newest first, each from the native source', async ({
  page,
}) => {
  await createProject(page, 'Activity Book');

  // The script: a folder, renamed; a document in it, renamed; then its text.
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByRole('textbox', { name: 'Rename Untitled' }).fill('Act One');
  await page.keyboard.press('Enter');
  await page.getByRole('toolbar', { name: 'Binder actions' }).getByRole('button', { name: 'New document' }).click();
  await page.getByRole('textbox', { name: 'Rename Untitled' }).fill('Scene');
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Document text' }).fill('Words to keep.');
  await waitForSaved(page);

  await page.getByRole('tab', { name: 'Activity' }).click();
  const rows = page.getByRole('list', { name: 'Activity' }).getByRole('listitem');
  await expect(rows.locator('.activity-title')).toHaveText([
    'Text saved',
    'Renamed',
    'New item',
    'Renamed',
    'New item',
  ]);
  await expect(rows.locator('.badge')).toHaveText(['Native', 'Native', 'Native', 'Native', 'Native']);
  // The view changes behind the script are in the log, and hidden until the writer asks for them.
  await expect(page.getByRole('list', { name: 'Activity' }).locator('[data-command^="view."]')).toHaveCount(0);
});

test('Undo on a row takes back its group, and the row keeps the record that it was undone', async ({ page }) => {
  await createProject(page, 'Undo Activity');
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByRole('textbox', { name: 'Rename Untitled' }).fill('Part');
  await page.keyboard.press('Enter');
  await page.getByRole('toolbar', { name: 'Binder actions' }).getByRole('button', { name: 'New document' }).click();
  await page.getByRole('textbox', { name: 'Rename Untitled' }).fill('Draft');
  await page.keyboard.press('Enter');
  const surface = page.getByRole('textbox', { name: 'Document text' });
  await surface.fill('A passage to take back.');
  await waitForSaved(page);

  await page.getByRole('tab', { name: 'Activity' }).click();
  const newest = page.getByRole('list', { name: 'Activity' }).getByRole('listitem').first();
  await expect(newest.locator('.activity-title')).toHaveText('Text saved');
  await newest.getByRole('button', { name: 'Undo' }).click();

  // The text is the stored text before that save, which was empty, and the editor shows it.
  await expect(surface).toHaveText('');
  // Its group has been undone, so its row no longer offers the undo.
  await expect(newest.getByRole('button', { name: 'Undo' })).toHaveCount(0);
});

test('only the newest change offers an Undo: an older one is disabled until the later changes are taken back', async ({
  page,
}) => {
  await createProject(page, 'Newest Undo');
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByRole('textbox', { name: 'Rename Untitled' }).fill('Part');
  await page.keyboard.press('Enter');

  await page.getByRole('tab', { name: 'Activity' }).click();
  const rows = page.getByRole('list', { name: 'Activity' }).getByRole('listitem');
  await expect(rows.locator('.activity-title')).toHaveText(['Renamed', 'New item']);

  // The rename is the newest change, so its Undo works. The creation under it is not, until the rename is taken back.
  const older = rows.nth(1).getByRole('button', { name: 'Undo' });
  await expect(older).toBeDisabled();
  await expect(older).toHaveAttribute('title', 'Undo the later changes first');
  await rows.nth(0).getByRole('button', { name: 'Undo' }).click();

  // Taking the rename back makes the creation the newest change, so its Undo is the one that works now.
  await expect(rows.last().getByRole('button', { name: 'Undo' })).toBeEnabled();
});
