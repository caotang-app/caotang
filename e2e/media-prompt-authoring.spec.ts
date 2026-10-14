/**
 * The in-shot prompt editor, in the app (video-prompt-pack.md §2–§3, storyboard.md §3.2). A shot's prompt for a target model is
 * written in the shot's own fields and kept across a reload; a check names what is missing and links to that field; and the
 * Prompt pack tab's checks link back to the field on the board.
 */

import { expect, test, type Page } from '@playwright/test';

import { binderTitle, createProject, firstChapter } from './support.js';

const PROJECT = 'Shot Prompts';

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

/** A storyboard with one shot, whose fields are open. */
async function openShotFields(page: Page): Promise<void> {
  await createProject(page, PROJECT);
  await makeUnder(page, 'Manuscript', 'New storyboard here');
  await makeUnder(page, 'Storyboard', 'New shot here');
  await page.getByRole('article', { name: 'Shot 1: New shot' }).getByRole('button', { name: 'Edit the fields of shot 1' }).click();
}

test('a shot’s prompt is written in its fields, a check names what is missing, and the check links to that field', async ({ page }) => {
  await openShotFields(page);
  await page.getByLabel('Prompt: camera').fill('Slow dolly-in');
  await page.getByLabel('Prompt: subject').fill('Elena');
  await page.getByRole('button', { name: 'Save prompt' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved the prompt for' })).toBeVisible();

  // The checks are the engine's rows for this shot: the target model needs a duration before its export is written.
  const checks = page.getByRole('list', { name: /^Checks for / });
  await expect(checks).toContainText('needs a duration');
  await checks.getByRole('button', { name: 'Go to the field' }).first().click();
  await expect(page.getByLabel('Clip length, seconds')).toBeFocused();

  await reopen(page);
  await binderTitle(page, 'Storyboard').click();
  await page.getByRole('article', { name: 'Shot 1: New shot' }).getByRole('button', { name: 'Edit the fields of shot 1' }).click();
  await expect(page.getByLabel('Prompt: camera')).toHaveValue('Slow dolly-in');
  await expect(page.getByLabel('Prompt: subject')).toHaveValue('Elena');
});

test('a shot’s unsaved action survives a save of its prompt, which is another section of the same shot', async ({ page }) => {
  await openShotFields(page);
  await page.getByLabel('Action', { exact: true }).fill('Elena walks down the quay.');
  await page.getByLabel('Prompt: camera').fill('Slow dolly-in');
  await page.getByLabel('Prompt: subject').fill('Elena');
  await page.getByRole('button', { name: 'Save prompt' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved the prompt for' })).toBeVisible();

  // The prompt save changes the shot's stored value, but not its action, so the writer's text in the Action box is kept. The box is
  // found by its role and name: a label's text stops matching once the box has text in it.
  await expect(page.getByRole('textbox', { name: 'Action', exact: true })).toHaveValue('Elena walks down the quay.');
});

test('a check on the Prompt pack tab links back to its field on the board', async ({ page }) => {
  await openShotFields(page);
  await page.getByLabel('Prompt: camera').fill('Slow dolly-in');
  await page.getByLabel('Prompt: subject').fill('Elena');
  await page.getByRole('button', { name: 'Save prompt' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved the prompt for' })).toBeVisible();

  await page.getByRole('radio', { name: 'Prompt pack', exact: true }).click();
  // The shot's checks are in its row of the pack, and each one that names a field links back to it on the board.
  await expect(page.locator('li.pp-shot')).toBeVisible();
  await page.locator('li.pp-shot').getByRole('button', { name: 'Fix on the board' }).first().click();

  await expect(page.getByRole('radio', { name: 'Board', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Clip length, seconds')).toBeFocused();
});

/** A 1×1 PNG, the smallest picture the store will take. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

// The pending window itself (the listing not yet back after the board remounts) is checked by shownListingOf's unit tests in
// e2e/unit/media-storyboard-board.spec.ts; this test sees only the settled picker.
test('after a pack link into a shot whose picture is in the project, the picker names the stored file (F-08)', async ({ page }) => {
  await openShotFields(page);
  await page.getByLabel('Choose an image file for shot 1').setInputFiles({ name: 'frame.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('article', { name: 'Shot 1: New shot' }).locator('img')).toBeVisible();
  await page.getByLabel('Prompt: camera').fill('Slow dolly-in');
  await page.getByLabel('Prompt: subject').fill('Elena');
  await page.getByRole('button', { name: 'Save prompt' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved the prompt for' })).toBeVisible();

  await page.getByRole('radio', { name: 'Prompt pack', exact: true }).click();
  await page.locator('li.pp-shot').getByRole('button', { name: 'Fix on the board' }).first().click();

  // The link opens the editor on the shot. Its picture is in the project's list, so the picker names the stored file (the import keeps
  // it under an opaque id): the sentence that says the picture is gone waits for a listing that has come back without it.
  await expect(page.getByLabel('Or use an image already in the project for shot 1').locator('option:checked')).toHaveText(/^a_[A-Za-z0-9_-]+\.png$/);
  await expect(page.getByText('This picture is no longer in the project')).toHaveCount(0);
});

test('the text typed for one vendor is kept when the writer switches to another vendor and back, and a save for the other vendor keeps it too', async ({ page }) => {
  await openShotFields(page);
  const vendor = page.getByLabel('Vendor for this prompt');
  await page.getByLabel('Prompt: camera').fill('Slow dolly-in on the harbour');
  // Switching vendor takes the writer to Veo 3.1, which holds no prompt yet, so its camera is empty.
  await vendor.selectOption('veo-3.1');
  await expect(page.getByLabel('Prompt: camera')).toHaveValue('');
  await page.getByLabel('Prompt: camera').fill('Static wide shot');
  await page.getByRole('button', { name: 'Save prompt' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved the prompt for Veo 3.1' })).toBeVisible();
  // The save changed Veo's stored record, and the Runway text is not Veo's: nothing says it was replaced, here or on the way back.
  await expect(page.getByText(/was replaced by the saved prompt/)).toHaveCount(0);

  // Back on Runway, the text typed before the switch is still there, unsaved, and nothing says it was replaced.
  await vendor.selectOption('runway-gen4');
  await expect(page.getByLabel('Prompt: camera')).toHaveValue('Slow dolly-in on the harbour');
  await expect(page.getByText(/was replaced by the saved prompt/)).toHaveCount(0);
  await vendor.selectOption('veo-3.1');
  await expect(page.getByLabel('Prompt: camera')).toHaveValue('Static wide shot');
});

test('an undo of a saved prompt takes the stored values in place of the unsaved text, and says so', async ({ page }) => {
  await openShotFields(page);
  await page.getByLabel('Prompt: camera').fill('Slow dolly-in');
  await page.getByLabel('Prompt: subject').fill('Elena');
  await page.getByRole('button', { name: 'Save prompt' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved the prompt for Runway Gen-4' })).toBeVisible();

  // The writer types on, unsaved, and the save is then undone: the stored prompt is gone, so the text the writer had typed is replaced.
  await page.getByLabel('Prompt: camera').fill('Slow dolly-in on the harbour');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'was replaced by the saved prompt' })).toBeVisible();
  await expect(page.getByLabel('Prompt: camera')).toHaveValue('');
});

test('the picture controls and the reference Remove button are named with their visible words, so a voice control finds them (WCAG 2.5.3)', async ({ page }) => {
  await openShotFields(page);
  await expect(page.getByLabel('Choose an image file for shot 1')).toBeAttached();
  await expect(page.getByRole('combobox', { name: 'Or use an image already in the project for shot 1' })).toBeVisible();

  // Each reference row has a Remove button, which the visible word finds inside the References fieldset.
  await page.getByRole('button', { name: 'Add a reference' }).click();
  const references = page.getByRole('group', { name: 'References' });
  await expect(references.getByRole('button', { name: 'Remove' })).toHaveCount(1);
  await expect(references.getByRole('button', { name: 'Remove reference 1' })).toBeVisible();
});
