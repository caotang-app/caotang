/**
 * The dialogue coverage picker, in the app (storyboard.md §3.2). The writer selects words in a scene's stored text, covers them,
 * and the coverage is kept in the shot across a reload; a covered passage can be removed. The picker shows the text the scene
 * stores, so the words the coverage names are the words in the script.
 */

import { expect, test, type Page } from '@playwright/test';

import { binderTitle, createProject, firstChapter, waitForSaved } from './support.js';

const PROJECT = 'Cover Story';
const SCENE_TEXT = 'INT. LIGHTHOUSE - NIGHT\n\nThe lamp turns.\n';

/** Makes a node from the context menu of the row it goes under, and keeps its default title. */
async function makeUnder(page: Page, under: string, item: string): Promise<void> {
  // The media entries are on chapters, so "under the manuscript" is its first chapter, made when there is none.
  const parent = under === 'Manuscript' ? await firstChapter(page) : under;
  await binderTitle(page, parent).click({ button: 'right' });
  await page.getByRole('menu', { name: `Actions for ${parent}` }).getByRole('menuitem', { name: item }).click();
  await page.keyboard.press('Escape');
}

/** Reloads the page and opens the project from the projects list. */
async function reopen(page: Page): Promise<void> {
  await page.reload();
  await page.getByRole('listitem').filter({ hasText: PROJECT }).getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('tree', { name: 'Binder' })).toBeVisible();
}

test('the words a shot covers are selected in the script, kept across a reload, and can be removed', async ({ page }) => {
  await createProject(page, PROJECT);
  await makeUnder(page, 'Manuscript', 'New screenplay scene here');
  await page.getByRole('radio', { name: 'Source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Fountain source' }).fill(SCENE_TEXT);
  await waitForSaved(page);

  await makeUnder(page, 'Manuscript', 'New storyboard here');
  await makeUnder(page, 'Storyboard', 'New shot here');
  await page.getByRole('article', { name: 'Shot 1: New shot' }).getByRole('button', { name: 'Edit the fields of shot 1' }).click();

  // The picker shows the scene's stored text, verbatim.
  const script = page.getByRole('textbox', { name: 'Script text' });
  await expect(script).toHaveValue(SCENE_TEXT);

  // Select the first words of the scene programmatically, then let a keyup carry them to the picker:
  // a mouse or keyboard selection's landing differs between runner OSes, while setSelectionRange is
  // exact, and the picker's own `onKeyUp` sync reads the area's selection as a writer's keys would.
  await script.evaluate((el) => {
    el.focus();
    el.setSelectionRange(0, 10);
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
  });
  await expect(page.getByText('10 characters selected.')).toBeVisible();
  await page.getByRole('button', { name: 'Cover the selected text' }).click();

  const covered = page.getByRole('list', { name: 'Covered script text' });
  await expect(covered).toContainText('INT.');

  await reopen(page);
  await binderTitle(page, 'Storyboard').click();
  await page.getByRole('article', { name: 'Shot 1: New shot' }).getByRole('button', { name: 'Edit the fields of shot 1' }).click();
  await expect(page.getByRole('list', { name: 'Covered script text' })).toContainText('INT.');

  await page.getByRole('button', { name: /^Remove the coverage of/ }).click();
  await expect(page.getByText('This shot covers no script text yet.')).toBeVisible();
});
