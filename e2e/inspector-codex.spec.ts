import { expect, test, type Page } from '@playwright/test';

import { binderRow, binderTitle, createProject, traceNames, waitForSaved } from './support.js';

/**
 * The inspector's codex section (codex.md §8): attach a codex entry to the open document from the inspector, see the entries
 * the document mentions as chips, and open one of them in the codex tab. Each attach is the bus's `codex.attach`.
 */

/** A chapter with one scene, built from the binder. */
async function chapterWithScene(page: Page, scene: string): Promise<void> {
  await createProject(page, 'Codex Chips');
  await page.getByRole('button', { name: 'Create Chapter 1' }).click();
  await expect(binderRow(page, 'Chapter 1')).toBeVisible();
  await page.getByRole('toolbar', { name: 'Binder actions' }).getByRole('button', { name: 'New document' }).click();
  await page.getByRole('textbox', { name: 'Rename Untitled' }).fill(scene);
  await page.keyboard.press('Enter');
  await expect(binderRow(page, scene)).toBeVisible();
}

test('an entry attached from the inspector is listed on the document, and a mention chip opens that entry in the codex', async ({
  page,
}) => {
  await chapterWithScene(page, 'The Harbour');

  // The entry, made in the codex panel.
  await page.getByRole('tab', { name: 'Codex' }).click();
  await page.getByRole('button', { name: 'New entry' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Elena');
  await page.getByRole('textbox', { name: 'Name', exact: true }).press('Enter');
  await page.getByRole('button', { name: '← All entries' }).click();

  // Attached to the scene from the inspector, not from the codex panel.
  await page.getByRole('tab', { name: 'Binder' }).click();
  await binderTitle(page, 'The Harbour').click();
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await inspector.getByRole('combobox', { name: 'Attach a codex entry' }).selectOption({ label: 'Elena' });
  await expect(inspector.locator('[data-codex-attached="Elena"]')).toBeVisible();
  await expect.poll(() => traceNames(page)).toContain('codex.attach');

  // Her name in the text is a mention, shown as a chip with its count, under the same section.
  await page.getByRole('textbox', { name: 'Document text' }).click();
  await page.keyboard.type('Elena walked to the harbour.');
  await waitForSaved(page);
  const chip = inspector.locator('[data-mention="Elena"]');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('1');

  // The chip opens the entry in the codex tab.
  await chip.click();
  await expect(page.getByRole('tab', { name: 'Codex' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Elena');

  // Detaching is the same command, the other way round.
  await page.getByRole('tab', { name: 'Binder' }).click();
  await inspector.locator('[data-codex-attached="Elena"]').getByRole('button', { name: 'Detach Elena' }).click();
  await expect(inspector.locator('[data-codex-attached="Elena"]')).toHaveCount(0);
  await expect.poll(async () => (await traceNames(page)).filter((name) => name === 'codex.attach').length).toBe(2);
});
