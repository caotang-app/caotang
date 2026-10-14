/**
 * The media views after an undo (media-track M1-M3, editor-engine §9). An undo is a write of its own, so it moves the revision the
 * store holds up past the view's. A view that did not re-seed its autosave on that revision wrote its next text against a revision
 * the store no longer had: every flush was refused, and the text was gone after a reload. Each test types, undoes, types again, and
 * checks that the second text is the one the store keeps across a reload.
 */

import { expect, test, type Page } from '@playwright/test';

import { binderTitle, bodyOf, createProject, firstChapter, idOf, waitForSaved } from './support.js';

const PROJECT = 'Undo Lamp';
const INK_FIRST = '=== start ===\nAlice: First.\n-> END\n';
const INK_SECOND = '=== start ===\nAlice: Second.\n-> END\n';
const SCENE_FIRST = 'INT. LIGHTHOUSE - NIGHT\n\nThe lamp turns.\n';
const SCENE_SECOND = 'INT. HARBOUR - DAY\n\nThe gulls wheel.\n';

/** Makes a node from the Manuscript's context menu, and leaves it with the title the binder gave it. */
async function makeUnderManuscript(page: Page, item: string): Promise<void> {
  // The media entries are on chapters, so the node goes into the manuscript's first chapter.
  await binderTitle(page, await firstChapter(page)).click({ button: 'right' });
  await page.getByRole('menu', { name: 'Actions for Chapter 1' }).getByRole('menuitem', { name: item }).click();
  await page.keyboard.press('Escape');
}

/** Reloads the page and opens the project from the projects list, as a writer does after a restart. */
async function reopen(page: Page): Promise<void> {
  await page.reload();
  await page.getByRole('listitem').filter({ hasText: PROJECT }).getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('tree', { name: 'Binder' })).toBeVisible();
}

test('a dialogue container keeps the text typed after an undo, across a reload', async ({ page }) => {
  await createProject(page, PROJECT);
  await makeUnderManuscript(page, 'New dialogue here');
  const ink = page.getByRole('textbox', { name: 'Ink source' });

  await ink.fill(INK_FIRST);
  await waitForSaved(page);
  const dialogueId = await idOf(page, 'Untitled dialogue');
  await expect.poll(() => bodyOf(page, dialogueId)).toBe(INK_FIRST);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  // The view takes the undone text, which is empty, and the store agrees with it.
  await expect(ink).toHaveValue('');
  await expect.poll(() => bodyOf(page, dialogueId)).toBe('');

  await ink.fill(INK_SECOND);
  await waitForSaved(page);
  await expect.poll(() => bodyOf(page, dialogueId)).toBe(INK_SECOND);

  await reopen(page);
  await binderTitle(page, 'Untitled dialogue').click();
  await expect(page.getByRole('textbox', { name: 'Ink source' })).toHaveValue(INK_SECOND);
});

test('a screenplay scene keeps the text typed after an undo, across a reload', async ({ page }) => {
  await createProject(page, PROJECT);
  await makeUnderManuscript(page, 'New screenplay scene here');
  await page.getByRole('radio', { name: 'Source', exact: true }).click();
  const source = page.getByRole('textbox', { name: 'Fountain source' });

  await source.fill(SCENE_FIRST);
  await waitForSaved(page);
  const sceneId = await idOf(page, 'Untitled scene');
  await expect.poll(() => bodyOf(page, sceneId)).toContain('The lamp turns.');

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(source).toHaveValue('');
  await expect.poll(() => bodyOf(page, sceneId)).toBe('');

  await source.fill(SCENE_SECOND);
  await waitForSaved(page);
  await expect.poll(() => bodyOf(page, sceneId)).toContain('The gulls wheel.');

  await reopen(page);
  await binderTitle(page, 'Untitled scene').click();
  await page.getByRole('radio', { name: 'Source', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Fountain source' })).toHaveValue(/The gulls wheel\./);
});
