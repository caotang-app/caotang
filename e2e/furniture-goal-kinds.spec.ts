import { expect, test, type Page } from '@playwright/test';

import { binderRow, createProject, waitForSaved } from './support.js';

/**
 * The goal picker in the inspector of the manuscript (goals-progress §9.2, §9.3): a goal counted in characters, and a weekly goal on
 * the manuscript. Each is set in the inspector's own words, read back there and in the binder footer's one line, and kept across a
 * reload, so the kind and the metric are what the project holds. The manuscript is not changed; the assertions are on what is shown.
 */

/** A chapter with one scene that holds fourteen non-whitespace characters: "The lamp was lit." */
async function chapterWithText(page: Page, name: string): Promise<void> {
  await createProject(page, name);
  await page.getByRole('button', { name: 'Create Chapter 1' }).click();
  await expect(binderRow(page, 'Chapter 1')).toBeVisible();
  await page.getByRole('toolbar', { name: 'Binder actions' }).getByRole('button', { name: 'New document' }).click();
  await page.getByRole('textbox', { name: 'Rename Untitled' }).fill('The Lamp');
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Document text' }).fill('The lamp was lit.');
  await waitForSaved(page);
}

/** Opens a project from the projects screen, after a reload, and waits for its binder. */
async function reopen(page: Page, name: string): Promise<void> {
  await page.reload();
  await page.locator('.project-row', { hasText: name }).getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('tree', { name: 'Binder' })).toBeVisible();
}

/** The manuscript's goals in the inspector: the manuscript is selected in the binder, which opens its inspector. */
async function manuscriptGoals(page: Page): Promise<ReturnType<Page['getByTestId']>> {
  await binderRow(page, 'Manuscript').click();
  return page.getByTestId('inspector-goals');
}

test('a goal counted in characters is set in characters, counts the characters of the text, and is kept across a reload', async ({
  page,
}) => {
  await chapterWithText(page, 'Character Goal');
  const goals = await manuscriptGoals(page);

  await goals.getByRole('combobox', { name: 'Inspector goal measure' }).selectOption('chars');
  await goals.getByLabel('Inspector goal characters').fill('100');
  await goals.getByRole('button', { name: 'Add goal' }).click();
  await expect(goals.locator('.goal-sentence')).toContainText('at least 100 characters on');
  // "The lamp was lit." holds fourteen characters that are not whitespace, so the goal is at fourteen of a hundred.
  await expect(goals.locator('.goal-line')).toContainText('14 of 100 characters · in progress');
  // The binder footer keeps the same goal as its one line.
  await expect(page.getByTestId('binder-footer').locator('.goal-sentence')).toContainText('at least 100 characters on');

  await waitForSaved(page);
  await reopen(page, 'Character Goal');
  await expect(page.getByTestId('binder-footer').locator('.goal-sentence')).toContainText('at least 100 characters on');
});

test('a weekly goal is set on the manuscript as a minimum, reads as its week, and is kept across a reload', async ({ page }) => {
  await chapterWithText(page, 'Weekly Goal');
  const goals = await manuscriptGoals(page);

  await goals.getByRole('combobox', { name: 'Inspector goal kind' }).selectOption('weekly');
  // A weekly goal is the manuscript's, a minimum, in words, with no date, so the form holds those fields while it is chosen.
  await expect(goals.getByRole('combobox', { name: 'Inspector goal comparison' })).toBeDisabled();
  await expect(goals.getByRole('combobox', { name: 'Inspector goal measure' })).toBeDisabled();
  await expect(goals.getByLabel('By (optional)')).toBeDisabled();
  await goals.getByLabel('Inspector goal words').fill('500');
  await goals.getByRole('button', { name: 'Add goal' }).click();
  await expect(goals.locator('.goal-sentence')).toContainText('at least 500 words this week');
  // The words written this week are the sessions that have ended and the sitting that is open, so the count is not asserted here.
  await expect(goals.locator('.goal-line')).toContainText(/of 500 words · in progress/);

  await waitForSaved(page);
  await reopen(page, 'Weekly Goal');
  // The footer's one line is the nearest project goal (goals-progress §4), so a weekly goal is not on it: it is read in the inspector.
  await expect(page.getByTestId('binder-footer').locator('.goal-sentence')).toHaveCount(0);
  await expect(page.getByTestId('binder-footer')).toContainText('No project goals yet.');
  const again = await manuscriptGoals(page);
  await expect(again.locator('.goal-sentence')).toContainText('at least 500 words this week');
});

test('Cancel in the goal form returns the focus to the Edit button that opened it', async ({ page }) => {
  await chapterWithText(page, 'Cancel Focus');
  const goals = await manuscriptGoals(page);
  await goals.getByLabel('Inspector goal words').fill('300');
  await goals.getByRole('button', { name: 'Add goal' }).click();

  await goals.getByRole('button', { name: /^Edit the goal/ }).click();
  await expect(goals.getByRole('button', { name: 'Save goal' })).toBeVisible();
  await goals.getByRole('button', { name: 'Cancel' }).click();
  await expect(goals.getByRole('button', { name: 'Add goal' })).toBeVisible();
  // Cancel was the control with the focus, and it has left the page, so the focus is on the Edit button and not on the body.
  await expect(goals.getByRole('button', { name: /^Edit the goal/ })).toBeFocused();
});

test('Remove moves the focus to the next goal’s Edit button, and to the form’s figure once no goal is left', async ({ page }) => {
  await chapterWithText(page, 'Remove Focus');
  const goals = await manuscriptGoals(page);
  for (const amount of ['300', '600']) {
    await goals.getByLabel('Inspector goal words').fill(amount);
    await goals.getByRole('button', { name: 'Add goal' }).click();
  }
  await expect(goals.locator('[data-goal]')).toHaveCount(2);

  // Remove leaves the page with its row, so the focus moves to the goal that takes the row's place, not to the body.
  await goals.getByRole('button', { name: /^Remove the goal at least 300 words/ }).click();
  await expect(goals.locator('[data-goal]')).toHaveCount(1);
  await expect(goals.getByRole('button', { name: /^Edit the goal at least 600 words/ })).toBeFocused();

  // With no goal left, the focus is on the form's figure, where the next goal is made.
  await goals.getByRole('button', { name: /^Remove the goal at least 600 words/ }).click();
  await expect(goals.locator('[data-goal]')).toHaveCount(0);
  await expect(goals.getByLabel('Inspector goal words')).toBeFocused();
});

test('removing the goal that is being changed clears the form, so a later save adds a goal instead of bringing that one back', async ({
  page,
}) => {
  await chapterWithText(page, 'Remove Editing');
  const goals = await manuscriptGoals(page);
  await goals.getByLabel('Inspector goal words').fill('300');
  await goals.getByRole('button', { name: 'Add goal' }).click();

  await goals.getByRole('button', { name: /^Edit the goal/ }).click();
  await goals.getByRole('button', { name: /^Remove the goal/ }).click();
  await expect(goals.locator('[data-goal]')).toHaveCount(0);
  // The form is an add form again: its button says so, and its figure is empty.
  await expect(goals.getByRole('button', { name: 'Add goal' })).toBeVisible();
  await expect(goals.getByLabel('Inspector goal words')).toHaveValue('');

  await goals.getByLabel('Inspector goal words').fill('400');
  await goals.getByRole('button', { name: 'Add goal' }).click();
  await expect(goals.locator('[data-goal]')).toHaveCount(1);
  await expect(goals.locator('.goal-sentence')).toContainText('at least 400 words');
});
