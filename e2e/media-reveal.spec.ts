/**
 * A finding's quote opens at its passage in the screenplay scene or the dialogue container it is in (coherence.md §8: click a quote
 * to reveal it). The prose editor already did this; the media views now select the passage in the text the writer edits. The tests
 * scan the manuscript, click the quote as a writer does, and read the selection of the field.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

import { binderTitle, createProject, firstChapter, waitForSaved } from './support.js';

const PROJECT = 'Reveal Book';

/** Makes a node from the context menu of the row it goes under, and keeps its default title (ui-modules §2.2). */
async function makeUnder(page: Page, under: string, item: string): Promise<void> {
  // The media entries are on chapters, so "under the manuscript" is its first chapter, made when there is none.
  const parent = under === 'Manuscript' ? await firstChapter(page) : under;
  await binderTitle(page, parent).click({ button: 'right' });
  await page.getByRole('menu', { name: `Actions for ${parent}` }).getByRole('menuitem', { name: item }).click();
  await page.keyboard.press('Escape');
}

/** What a field has selected: its start, its end and the text between them. */
async function selectionOf(field: Locator): Promise<{ from: number; to: number; text: string }> {
  return field.evaluate((element) => {
    const area = element as HTMLTextAreaElement;
    return { from: area.selectionStart, to: area.selectionEnd, text: area.value.slice(area.selectionStart, area.selectionEnd) };
  });
}

/** The quoted passage a finding card shows, without the typographic quotes around it. */
async function quotedText(quote: Locator): Promise<string> {
  return ((await quote.textContent()) ?? '').replace(/^“|”$/g, '').trimEnd();
}

test('a quote of a finding in a dialogue container selects that passage in its Ink text', async ({ page }) => {
  await createProject(page, PROJECT);
  await makeUnder(page, 'Manuscript', 'New dialogue here');
  const body = ['=== start ===', 'Mara: Who is it?', '-> END', ''].join('\n');
  const ink = page.getByRole('textbox', { name: 'Ink source' });
  await ink.fill(body);
  await waitForSaved(page);

  await page.getByRole('tab', { name: 'Findings' }).click();
  await page.getByRole('button', { name: 'Scan the manuscript' }).click();
  const quote = page.locator('.finding-quote', { hasText: 'Mara' }).first();
  await expect(quote).toBeVisible();
  const passage = await quotedText(quote);
  await quote.click();

  // The Ink text holds the passage selected, at the place the body has it.
  await expect.poll(async () => (await selectionOf(ink)).text).toBe(passage);
  expect((await selectionOf(ink)).from).toBe(body.indexOf(passage));
});

test('a quote of a finding in a screenplay scene opens the Source tab with that passage selected', async ({ page }) => {
  await createProject(page, PROJECT);
  await makeUnder(page, 'Manuscript', 'New screenplay scene here');
  await page.getByRole('radio', { name: 'Source', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Fountain source' });
  await field.fill('INT. LIGHTHOUSE - NIGHT\n\nELENA\nIs anyone there?\n');
  await waitForSaved(page);

  // The scene is on its Script tab when the quote is clicked, so the click has to bring the Source tab back.
  await page.getByRole('tab', { name: 'Findings' }).click();
  await page.getByRole('button', { name: 'Scan the manuscript' }).click();
  const quote = page.locator('.finding-quote', { hasText: 'ELENA' }).first();
  await expect(quote).toBeVisible();
  const passage = await quotedText(quote);
  await page.getByRole('radio', { name: 'Script', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Script', exact: true })).toHaveAttribute('aria-checked', 'true');

  await quote.click();
  await expect(page.getByRole('radio', { name: 'Source', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await selectionOf(field)).text).toBe(passage);
  expect((await selectionOf(field)).from).toBe('INT. LIGHTHOUSE - NIGHT\n\nELENA\nIs anyone there?\n'.indexOf(passage));
});
