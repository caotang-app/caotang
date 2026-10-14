/**
 * The dialogue view as a writer reads it (dialogue-narrative.md §3 and §5): a choice's label is drawn on its arrow (M2), a compile error
 * names its line once (L6), and a codex alias clears a speaker finding in the open container at once, with no edit to the Ink text (L7).
 * The tests read the view through what is on screen, as a writer does, and make the codex change through the codex panel.
 */

import { expect, test, type Page } from '@playwright/test';

import { binderTitle, createProject, firstChapter, waitForSaved } from './support.js';

const PROJECT = 'Harbour Talk';
const DIALOGUE = 'Untitled dialogue';

/** Makes a node from the context menu of the row it goes under, and keeps its default title (ui-modules §2.2). */
async function makeUnder(page: Page, under: string, item: string): Promise<void> {
  // The media entries are on chapters, so "under the manuscript" is its first chapter, made when there is none.
  const parent = under === 'Manuscript' ? await firstChapter(page) : under;
  await binderTitle(page, parent).click({ button: 'right' });
  await page.getByRole('menu', { name: `Actions for ${parent}` }).getByRole('menuitem', { name: item }).click();
  await page.keyboard.press('Escape');
}

/** A dialogue container made from the binder, and its Ink text written and saved. */
async function dialogueWith(page: Page, ink: string): Promise<void> {
  await createProject(page, PROJECT);
  await makeUnder(page, 'Manuscript', 'New dialogue here');
  await expect(page.getByRole('region', { name: `Dialogue: ${DIALOGUE}` })).toBeVisible();
  await page.getByRole('textbox', { name: 'Ink source' }).fill(ink);
  await waitForSaved(page);
}

test('a choice is drawn as a label on its arrow, and the choices list keeps the whole label (M2)', async ({ page }) => {
  await dialogueWith(
    page,
    ['=== start ===', 'Mara: Which way?', '* [Left] -> left', '* [Right] -> right', '=== left ===', 'Mara: Left, then.', '-> END', '=== right ===', 'Mara: Right, then.', '-> END', ''].join('\n'),
  );
  const view = page.getByRole('region', { name: `Dialogue: ${DIALOGUE}` });
  // The words drawn on the arrows are the label's own text nodes. The tooltip is a child element, so it is left out of them, and a
  // label drawn with no visible text would fail here even if its tooltip still read the choice.
  const drawnWords = await view.locator('.dlg-edge-label').evaluateAll((labels) =>
    labels.map((label) =>
      Array.from(label.childNodes)
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent ?? '')
        .join(''),
    ),
  );
  expect(drawnWords.sort()).toEqual(['Left', 'Right']);
  // The full label is the tooltip of its edge.
  const tooltips = await view.locator('.dlg-edge-label title').allTextContents();
  expect(tooltips.sort()).toEqual(['Left', 'Right']);
  // The choices list is the node's own detail, so the node the choices come from is chosen first (the same card the graph shows).
  await view.getByRole('button', { name: /^start:/ }).click();
  await expect(view.getByRole('list', { name: 'Choices' }).getByText('“Left” → left')).toBeVisible();
});

test('a compile error names its line once, in the words the view uses for every line (L6)', async ({ page }) => {
  await dialogueWith(page, ['=== start ===', 'Mara: Hello.', '-> nowhere', ''].join('\n'));
  const alert = page.getByRole('alert', { name: 'Compile errors' });
  await expect(alert).toBeVisible();
  const first = (await alert.locator('li').first().textContent()) ?? '';
  expect(first).toMatch(/^line \d+: /);
  expect(first).not.toContain('ERROR');
  expect(first.match(/line \d+/g)).toHaveLength(1);
});

test('a codex alias clears the open container’s speaker finding at once, with no edit to the text (L7)', async ({ page }) => {
  // The top of the body diverts to the knot, so the knot is reached and the speaker is the only finding the container has.
  await dialogueWith(page, ['-> start', '=== start ===', 'Elena: It is me.', '-> END', ''].join('\n'));
  const view = page.getByRole('region', { name: `Dialogue: ${DIALOGUE}` });
  await expect(view.getByText('matches no codex character')).toBeVisible();

  // The codex panel is in the left rail, so the container stays open in the centre while the entry is made.
  await page.getByRole('tab', { name: 'Codex' }).click();
  await page.getByRole('button', { name: 'New entry' }).click();
  const name = page.getByRole('textbox', { name: 'Name' });
  await name.fill('Elena Marsh');
  await name.press('Enter');
  const alias = page.getByRole('textbox', { name: 'Add to aliases' });
  await alias.fill('Elena');
  await alias.press('Enter');
  await expect(page.getByRole('list', { name: 'Aliases' })).toContainText('Elena');

  // The container was not edited: its finding goes because the codex now names the speaker, the way the Findings scan reads it.
  await expect(view.getByText('matches no codex character')).toHaveCount(0);
  await expect(view.getByText('No loose end, dead end or unknown speaker in this container.')).toBeVisible();
});

test('the Inspector’s findings count of a container follows a codex alias at once, as the view does (L7)', async ({ page }) => {
  await dialogueWith(page, ['-> start', '=== start ===', 'Elena: It is me.', '-> END', ''].join('\n'));
  await binderTitle(page, DIALOGUE).click();
  // The container settings show the structure of the Ink text, and its findings count is the one the Inspector kept stale (L7).
  const findings = page
    .getByRole('complementary', { name: 'Inspector' })
    .getByTestId('dialogue-meta')
    .locator('.dlg-counts > div', { hasText: 'Findings' })
    .locator('dd');
  await expect(findings).toHaveText('1');

  await page.getByRole('tab', { name: 'Codex' }).click();
  await page.getByRole('button', { name: 'New entry' }).click();
  const name = page.getByRole('textbox', { name: 'Name' });
  await name.fill('Elena Marsh');
  await name.press('Enter');
  const alias = page.getByRole('textbox', { name: 'Add to aliases' });
  await alias.fill('Elena');
  await alias.press('Enter');
  await expect(page.getByRole('list', { name: 'Aliases' })).toContainText('Elena');

  await expect(findings).toHaveText('0');
});
