import { expect, test, type Page } from '@playwright/test';

import { createProject, waitForSaved } from './support.js';

/**
 * The codex panel's two guided moves (codex-panels §1, codex.md §8). An empty codex offers a seed card that starts an agent intent
 * to draft entries from the manuscript. An entry's appearance in a document opens that document at the entry's first mention, so
 * the writer lands on the word the list named.
 */

/** A chapter with one scene in it, named and holding `text`, saved. */
async function sceneWithText(page: Page, title: string, text: string): Promise<void> {
  await page.getByRole('tab', { name: 'Binder' }).click();
  await page.getByRole('button', { name: 'Create Chapter 1' }).click();
  await page.getByRole('toolbar', { name: 'Binder actions' }).getByRole('button', { name: 'New document' }).click();
  await page.getByRole('textbox', { name: 'Rename Untitled' }).fill(title);
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Document text' }).fill(text);
  await waitForSaved(page);
}

test('an empty codex offers the agent a seed: the card starts the intent, and the agent panel opens on it', async ({ page }) => {
  await createProject(page, 'Codex Seed');
  await page.getByRole('tab', { name: 'Codex' }).click();
  await expect(page.getByRole('heading', { name: 'The codex is empty' })).toBeVisible();

  await page.getByRole('button', { name: 'Let the agent draft entries from your manuscript' }).click();
  await expect(page.getByTestId('agent-panel')).toHaveClass(/is-open/);
  await expect(page.locator('.agent-intent-text', { hasText: 'Draft codex entries for the people, places and things in my manuscript.' })).toBeVisible();
});

test('an appearance opens its document, and the document shows the mention it names', async ({ page }) => {
  await createProject(page, 'Codex Reveal');
  const text = 'The ferry came in. Mara waited on the pier. Mara waved.';
  await sceneWithText(page, 'Harbour', text);

  await page.getByRole('tab', { name: 'Codex' }).click();
  await page.getByRole('button', { name: 'New entry' }).click();
  const name = page.getByRole('textbox', { name: 'Name' });
  await name.fill('Mara');
  await name.press('Enter');
  await page.getByRole('button', { name: '← All entries' }).click();
  await page.getByRole('button', { name: /^Mara/ }).click();

  const appears = page.getByRole('region', { name: 'Appears in' });
  await expect(appears).toContainText('2 mentions in 1 document');
  // The document is not open yet: the appearance list is where the writer reads about the entry.
  await appears.getByRole('button', { name: /^Harbour/ }).click();

  await expect(page.getByRole('textbox', { name: 'Document text' })).toContainText('Mara waited on the pier.');
  // The reveal puts the caret on the first mention (codex-panels §1, firstOffset), not on the start of the document. A collapsed caret
  // is no selection to the test hook, and the page's own selection follows the editor only once it has focus, so the editor is focused
  // and the caret is read from the page: the text from the start of the editor to it.
  await page.getByRole('textbox', { name: 'Document text' }).focus();
  await expect.poll(() => caretOffset(page)).toBe(text.indexOf('Mara'));
});

/** The caret's offset in the open document, as the length of the text from the start of the editor to the caret, or `null`. */
async function caretOffset(page: Page): Promise<number | null> {
  return page.getByRole('textbox', { name: 'Document text' }).evaluate((editor) => {
    const sel = window.getSelection();
    if (sel === null || sel.anchorNode === null || !editor.contains(sel.anchorNode)) return null;
    const range = document.createRange();
    range.setStart(editor, 0);
    range.setEnd(sel.anchorNode, sel.anchorOffset);
    return range.toString().length;
  });
}
