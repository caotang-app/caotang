/**
 * The screenplay in the app (screenplay.md §2.2, §3). A whole Fountain file is imported as sections and scenes in one
 * command, the Source tab draws the script's elements and answers Enter and Tab on a cue, and the Pages tab shows the scene
 * as it prints, read only. media/README.md says what each view does; these tests read the app through its gestures.
 */

import { expect, test, type Page } from '@playwright/test';

import { binderTitle, bodyOf, createProject, firstChapter, idOf, traceNames, treeOf, waitForSaved } from './support.js';

const PROJECT = 'Night Shift';

/** A two-act script with a section synopsis, a sequence, and a scene synopsis, in the form the importer reads back. */
const SCRIPT = [
  '# Act One',
  '= The setup.',
  '## Sequence A',
  'INT. HOUSE - DAY',
  '',
  'Alice waves.',
  '',
  'EXT. STREET - NIGHT',
  '= Rain.',
  '',
  'Rain falls.',
  '',
  '# Act Two',
  '',
  'INT. CELLAR - NIGHT',
  '',
  'Cold.',
  '',
].join('\n');

const SCENE = ['INT. HOUSE - DAY', '', 'MARCUS', 'Hi.', '', 'MA'].join('\n');

/**
 * Makes a screenplay scene from the context menu of the manuscript, as the media node specs do, and leaves it with the title
 * the binder gave it.
 */
async function makeScene(page: Page): Promise<void> {
  // The media entries are on chapters, so the node goes into the manuscript's first chapter.
  await binderTitle(page, await firstChapter(page)).click({ button: 'right' });
  await page.getByRole('menu', { name: 'Actions for Chapter 1' }).getByRole('menuitem', { name: 'New screenplay scene here' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Screenplay: Untitled scene' })).toBeVisible();
}

/** The Fountain source field, which the Source tab shows. */
function source(page: Page) {
  return page.getByRole('textbox', { name: 'Fountain source' });
}

test('a whole Fountain file imports as sections and scenes, and the import is one step the trace names', async ({ page }) => {
  await createProject(page, PROJECT);
  await page.locator('input[type="file"][aria-label="Script file"]').setInputFiles({
    name: 'night.fountain',
    mimeType: 'text/plain',
    buffer: Buffer.from(SCRIPT),
  });

  await expect(page.getByText(/Imported 3 scenes and 3 sections from night\.fountain/)).toBeVisible();
  await waitForSaved(page);
  await expect.poll(() => traceNames(page)).toContain('screenplay.import');

  const tree = await treeOf(page);
  const actOne = tree.find((node) => node.title === 'Act One');
  const sequence = tree.find((node) => node.title === 'Sequence A');
  expect(actOne?.type).toBe('folder');
  expect(sequence?.parentId).toBe(actOne?.id);
  const house = tree.find((node) => node.title === 'INT. HOUSE - DAY');
  expect(house?.parentId).toBe(sequence?.id);
  await expect.poll(() => bodyOf(page, house?.id ?? '')).toBe('INT. HOUSE - DAY\n\nAlice waves.');
});

test('the Source tab draws a scene heading and a cue, and Tab completes a cue from the cues already in the scene', async ({ page }) => {
  await createProject(page, PROJECT);
  await makeScene(page);
  await page.getByRole('radio', { name: 'Source', exact: true }).click();
  await source(page).fill(SCENE);

  // The decoration layer draws the heading and the cue, under the input, and changes none of the text.
  await expect(page.locator('.src-layer .tok-heading')).toHaveText('INT. HOUSE - DAY');
  await expect(page.locator('.src-layer .tok-cue')).toHaveText('MARCUS');
  await expect(source(page)).toHaveValue(SCENE);

  // "MA" is the start of "MARCUS", the cue already in the scene, so Tab completes it in capitals.
  await source(page).press('Tab');
  await expect(source(page)).toHaveValue(SCENE.replace(/MA$/, 'MARCUS'));
});

test('Enter at the end of a cue moves onto its dialogue, with no blank line made between them', async ({ page }) => {
  await createProject(page, PROJECT);
  await makeScene(page);
  await page.getByRole('radio', { name: 'Source', exact: true }).click();
  await source(page).fill(['INT. HOUSE - DAY', '', 'MARCUS', 'Hi.'].join('\n'));

  // The caret is at the end of "Hi."; up and to the end of the line above puts it at the end of the cue.
  await source(page).press('ArrowUp');
  await source(page).press('End');
  await source(page).press('Enter');
  // The caret is now at the start of "Hi.", so what is typed goes in front of it.
  await source(page).pressSequentially('X');
  await expect(source(page)).toHaveValue(['INT. HOUSE - DAY', '', 'MARCUS', 'XHi.'].join('\n'));
});

test('the Pages tab shows the scene as it prints, read only', async ({ page }) => {
  await createProject(page, PROJECT);
  await makeScene(page);
  await page.getByRole('radio', { name: 'Source', exact: true }).click();
  await source(page).fill(SCENE);

  await page.getByRole('radio', { name: 'Pages', exact: true }).click();
  const preview = page.getByLabel('Paginated preview');
  await expect(preview).toBeVisible();
  await expect(page.getByRole('region', { name: 'Page 1' })).toBeVisible();
  await expect(preview.locator('.sp-line-scene')).toHaveText('INT. HOUSE - DAY');
  // The preview writes nothing: the text is the one the Source tab holds.
  await waitForSaved(page);
  const id = await idOf(page, 'Untitled scene');
  await expect.poll(() => bodyOf(page, id)).toContain('MARCUS');
});

test('the scene\'s heading and cue carry their decoration after a reload', async ({ page }) => {
  await createProject(page, PROJECT);
  await makeScene(page);
  await page.getByRole('radio', { name: 'Source', exact: true }).click();
  await source(page).fill(SCENE);
  await waitForSaved(page);
  await page.reload();
  await page.getByRole('listitem').filter({ hasText: PROJECT }).getByRole('button', { name: 'Open' }).click();
  await binderTitle(page, 'Untitled scene').click();
  await page.getByRole('radio', { name: 'Source', exact: true }).click();
  await expect(page.locator('.src-layer .tok-heading')).toHaveText('INT. HOUSE - DAY');
});
