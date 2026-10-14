import { expect, test, type Page } from '@playwright/test';

import { binderRow, binderTitle, createProject, traceNames, waitForSaved } from './support.js';

/**
 * The Findings tab's controls (coherence.md §6.2, §6.3, §8): the names a screen reader reads on a quoted passage and a run's
 * controls, where the focus goes around the dismissal picker, and the approval a run over the document guard asks for again.
 */

/** A chapter with two scenes whose declared days break their order, and a scan run over them, as the findings tests start. */
async function declaredAndScanned(page: Page): Promise<void> {
  await createProject(page, 'Controls Book');
  await page.getByRole('button', { name: 'Create Chapter 1' }).click();
  await expect(binderRow(page, 'Chapter 1')).toBeVisible();
  for (const scene of ['Scene A', 'Scene B']) {
    await page.getByRole('toolbar', { name: 'Binder actions' }).getByRole('button', { name: 'New document' }).click();
    await page.getByRole('textbox', { name: 'Rename Untitled' }).fill(scene);
    await page.keyboard.press('Enter');
    await expect(binderRow(page, scene)).toBeVisible();
  }
  const surface = page.getByRole('textbox', { name: 'Document text' });
  await binderTitle(page, 'Scene A').click();
  await page.getByTestId('scene-meta').locator('summary').click();
  await page.getByRole('spinbutton', { name: 'Day offset' }).fill('5');
  await page.getByRole('spinbutton', { name: 'Day offset' }).press('Enter');
  await surface.click();
  await page.keyboard.type('The ferry was late, as always.');
  await waitForSaved(page);

  await binderTitle(page, 'Scene B').click();
  await page.getByTestId('scene-meta').locator('summary').click();
  await page.getByRole('spinbutton', { name: 'Day offset' }).fill('1');
  await page.getByRole('spinbutton', { name: 'Day offset' }).press('Enter');
  await page.getByRole('combobox', { name: 'Add a scene this follows' }).selectOption({ label: 'Scene A' });
  await expect(page.getByRole('list', { name: 'Follows these scenes' })).toContainText('Scene A');
  await expect.poll(() => traceNames(page)).toContain('coherence.setSceneMeta');
  await surface.click();
  await page.keyboard.type('The lamp went out before the ferry came in.');
  await waitForSaved(page);

  await page.getByRole('tab', { name: 'Findings' }).click();
  await page.getByRole('button', { name: 'Scan the manuscript' }).click();
  await expect(page.getByRole('region', { name: 'Errors' })).toBeVisible();
  await expect(page.getByTestId('findings-open')).toHaveText('2 open');
}

test('a quoted passage is named by the passage it opens, and a run’s discard by its visible words', async ({ page }) => {
  await declaredAndScanned(page);
  const errors = page.getByRole('region', { name: 'Errors' });

  // The name is the quoted text itself; the document it is in is the description, so the name holds the visible words.
  const quote = errors.locator('.finding-quote').first();
  await expect(quote).toHaveAccessibleName(/^“.+”$/);
  await expect(quote).toHaveAccessibleDescription(/Scene [AB]/);

  const discard = page.getByRole('region', { name: 'Run history' }).getByRole('button', { name: 'Discard run' }).first();
  await expect(discard).toHaveAccessibleName(/^Discard run from /);
});

test('the dismissal picker takes focus when it opens, closes on Escape to its card, and after a dismissal focus goes to the next open card', async ({
  page,
}) => {
  await declaredAndScanned(page);
  const errors = page.getByRole('region', { name: 'Errors' });
  const notes = page.getByRole('region', { name: 'Notes' });
  const picker = page.getByRole('dialog', { name: /Dismiss the finding/ });

  // Opened from the keyboard: the first reason has focus, and Escape cancels back to the control that opened it.
  const opener = errors.getByRole('button', { name: 'Dismiss…' });
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('radio').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(opener).toBeFocused();

  // Cancel with the button gives the focus back the same way.
  await opener.click();
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'Cancel' }).click();
  await expect(picker).toHaveCount(0);
  await expect(opener).toBeFocused();

  // A dismissal moves focus to the next open card, since the dismissed one leaves the open list.
  await opener.click();
  await picker.getByRole('radio', { name: 'False positive' }).check();
  await picker.getByRole('button', { name: 'Dismiss finding' }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByTestId('findings-open')).toHaveText('1 open');
  await expect(notes.getByRole('button', { name: 'Dismiss…' })).toBeFocused();
});

test('when the last open finding is dismissed, focus goes to the Findings heading', async ({ page }) => {
  await declaredAndScanned(page);
  const picker = page.getByRole('dialog', { name: /Dismiss the finding/ });
  for (const region of ['Errors', 'Notes']) {
    await page.getByRole('region', { name: region }).getByRole('button', { name: 'Dismiss…' }).click();
    await picker.getByRole('radio', { name: 'False positive' }).check();
    await picker.getByRole('button', { name: 'Dismiss finding' }).click();
    await expect(picker).toHaveCount(0);
  }
  await expect(page.getByTestId('findings-open')).toHaveText('0 open');
  await expect(page.locator('.findings-head')).toBeFocused();
});

test('a run over the document guard asks for approval again when it is run again, and approving it runs the run’s own scope', async ({
  page,
}) => {
  // Twenty-one scenes is one over the guard (coherence.md §6.2): the first scan asks, and so does Run again on its run.
  // Each scene holds a line of text, since an empty document is skipped and does not count toward the guard.
  test.setTimeout(240_000);
  await createProject(page, 'Guard Book');
  await page.getByRole('button', { name: 'Create Chapter 1' }).click();
  await expect(binderRow(page, 'Chapter 1')).toBeVisible();
  const surface = page.getByRole('textbox', { name: 'Document text' });
  for (let index = 1; index <= 21; index += 1) {
    await page.getByRole('toolbar', { name: 'Binder actions' }).getByRole('button', { name: 'New document' }).click();
    await page.getByRole('textbox', { name: 'Rename Untitled' }).fill(`Scene ${index}`);
    await page.keyboard.press('Enter');
    await expect(binderRow(page, `Scene ${index}`)).toBeVisible();
    await binderTitle(page, `Scene ${index}`).click();
    await surface.click();
    await page.keyboard.type(`The bell rang ${index} times.`);
    await waitForSaved(page);
  }

  await page.getByRole('tab', { name: 'Findings' }).click();
  await page.getByRole('combobox', { name: 'Scope of the scan and the review' }).selectOption({ label: 'Whole manuscript' });
  await page.getByRole('button', { name: 'Scan the manuscript' }).click();
  const question = 'This scope covers more than 20 documents. Split it, or press “Scan it anyway” to scan all of it.';
  await expect(page.getByText(question)).toBeVisible();
  await page.getByRole('button', { name: 'Scan it anyway' }).click();
  await expect(page.getByRole('region', { name: 'Run history' }).locator('[data-run]')).toHaveCount(1);

  // Run again on that run: the same question, with a control that answers it.
  await page.getByRole('region', { name: 'Run history' }).getByRole('button', { name: 'Run again' }).click();
  await expect(page.getByText(question)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scan it anyway' })).toBeVisible();
  await page.getByRole('button', { name: 'Scan it anyway' }).click();
  await expect(page.getByRole('region', { name: 'Run history' }).locator('[data-run]')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Scan it anyway' })).toHaveCount(0);
});
