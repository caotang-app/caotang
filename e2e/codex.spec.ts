import { expect, test, type Page } from '@playwright/test';

import { createProject, projectTrace, waitForSaved } from './support.js';

/**
 * codex.md §4 and §8, codex-panels.md §1: an entry made in the codex panel is found in the prose by its
 * name and its aliases, and the appearance view lists the scenes that mention it, with the counts. Every
 * change to an entry is a bus command.
 */

/** Open the codex rail tab. */
async function openCodex(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Codex' }).click();
}

/** A chapter and one scene in it, named and holding `text`, saved. */
async function sceneWithText(page: Page, title: string, text: string): Promise<void> {
  await page.getByRole('tab', { name: 'Binder' }).click();
  await page.getByRole('button', { name: 'Create Chapter 1' }).click();
  await page.getByRole('toolbar', { name: 'Binder actions' }).getByRole('button', { name: 'New document' }).click();
  await page.getByRole('textbox', { name: 'Rename Untitled' }).fill(title);
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Document text' }).fill(text);
  await waitForSaved(page);
}

test('a codex entry created in the panel is detected in a document and shows in the appearance view', async ({
  page,
}) => {
  await createProject(page, 'Codex Book');

  // The entry, made and named in the panel, with an alias. The entry's editor opens on creation.
  await openCodex(page);
  await page.getByRole('button', { name: 'New entry' }).click();
  const name = page.getByRole('textbox', { name: 'Name' });
  await name.fill('Elena');
  await name.press('Enter');
  const alias = page.getByRole('textbox', { name: 'Add to aliases' });
  await alias.fill('Ellie');
  await alias.press('Enter');
  await expect(page.getByRole('list', { name: 'Aliases' })).toContainText('Ellie');
  await page.getByRole('button', { name: '← All entries' }).click();
  await expect(page.getByRole('button', { name: /^Elena/ })).toBeVisible();

  // A scene that names her, by name and by alias.
  await sceneWithText(page, 'Harbour', 'Elena walked to the harbour. Ellie waved from the pier.');

  // The panel finds her in the scene: one name, one alias.
  await openCodex(page);
  await page.getByRole('button', { name: /^Elena/ }).click();
  const appears = page.getByRole('region', { name: 'Appears in' });
  await expect(appears).toContainText('2 mentions in 1 document');
  await expect(appears.getByRole('button', { name: /^Harbour/ })).toBeVisible();

  // Every change above was a bus command, and the codex changed through codex.upsert alone.
  const commands = await projectTrace(page);
  expect(commands).toContain('codex.upsert');
  expect(commands).not.toContain('codex.attach');
});

test('an entry attached to a scene is listed as attached, and detaching takes it off, each a codex.attach command', async ({
  page,
}) => {
  await createProject(page, 'Attach Book');
  await sceneWithText(page, 'Quay', 'The harbourmaster was late.');

  await openCodex(page);
  await page.getByRole('button', { name: 'New entry' }).click();
  const name = page.getByRole('textbox', { name: 'Name' });
  await name.fill('Harbourmaster');
  await name.press('Enter');

  await page.getByRole('combobox', { name: 'Attach to' }).selectOption({ label: 'Quay' });
  await expect(page.getByRole('list', { name: 'Attachments' })).toContainText('Quay');
  expect(await projectTrace(page)).toContain('codex.attach');

  await page.getByRole('button', { name: 'Detach from Quay' }).click();
  await expect(page.getByRole('list', { name: 'Attachments' })).toHaveCount(0);
  await expect(page.getByText('Attached to no items yet')).toBeVisible();
});

test('the appearance view follows the text: a scene that stops naming the entry drops out of it', async ({ page }) => {
  await createProject(page, 'Follow Book');
  await openCodex(page);
  await page.getByRole('button', { name: 'New entry' }).click();
  const name = page.getByRole('textbox', { name: 'Name' });
  await name.fill('Marta');
  await name.press('Enter');
  await page.getByRole('button', { name: '← All entries' }).click();

  await sceneWithText(page, 'Dock', 'Marta counted the crates.');
  await openCodex(page);
  await page.getByRole('button', { name: /^Marta/ }).click();
  await expect(page.getByRole('region', { name: 'Appears in' })).toContainText('1 mention in 1 document');

  // The writer takes her name out of the scene. The count is read again, not kept.
  await page.getByRole('tab', { name: 'Binder' }).click();
  await page.getByRole('textbox', { name: 'Document text' }).fill('The crates were counted.');
  await waitForSaved(page);
  await openCodex(page);
  await page.getByRole('button', { name: /^Marta/ }).click();
  await expect(page.getByRole('region', { name: 'Appears in' })).toContainText('No mentions yet');
});
