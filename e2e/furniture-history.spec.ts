import { expect, test } from '@playwright/test';

import { createProject, freezeClock } from './support.js';

/**
 * The writing history in the binder footer (goals-progress §9.1): it opens and closes from the footer, it shows the four
 * stats and the ten bars, and its CSV is offered only once a day has words in it. The arithmetic is unit-tested in
 * packages/furniture/test/history.test.ts; this checks what the writer sees.
 */

test('the writing history opens from the binder footer, shows its stats and bars, and offers no CSV before any writing', async ({ page }) => {
  await createProject(page, 'History');
  await expect(page.getByRole('button', { name: 'Show the history' })).toHaveAttribute('aria-expanded', 'false');

  await page.getByRole('button', { name: 'Show the history' }).click();
  await expect(page.getByRole('button', { name: 'Hide the history' })).toHaveAttribute('aria-expanded', 'true');
  const stats = page.getByTestId('history-stats');
  await expect(stats).toContainText('Today');
  await expect(stats).toContainText('0 words');
  await expect(stats).toContainText('Daily average');
  await expect(stats).toContainText('Daily best');
  await expect(page.getByRole('list', { name: /Words on each of the last 10 days/ }).locator('li')).toHaveCount(10);
  await expect(page.getByText('No writing is recorded yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download CSV' })).toBeDisabled();

  await page.getByRole('button', { name: 'Hide the history' }).click();
  await expect(page.getByTestId('history-stats')).toHaveCount(0);
});

test('each history bar says its day and its words in text, the bar under the pointer is read out under the chart, and a sprint that is stopped is announced', async ({ page }) => {
  await createProject(page, 'History Words');
  await page.getByRole('button', { name: 'Show the history' }).click();
  const bars = page.getByRole('list', { name: /Words on each of the last 10 days/ }).locator('li');
  await expect(bars).toHaveCount(10);
  // A bar is a picture to a sighted reader; its day and count are text for everyone else (goals-progress §9.1).
  await expect(bars.first()).toContainText(/\d{4}-\d{2}-\d{2}: 0 words/);
  // The day and count are said once, in the bar's own text: a title attribute would have the same sentence read a second time.
  await expect(bars.first()).not.toHaveAttribute('title');

  // A sighted reader points at a bar, even a day with no words and so no height, and reads the same sentence under the chart.
  // The readout is hidden from a screen reader, which has already read the bar's own text.
  const readout = page.getByTestId('history-readout');
  await expect(readout).toHaveAttribute('aria-hidden', 'true');
  await expect(readout).toHaveText('Point at a bar to read its day and words.');
  const chart = page.getByRole('list', { name: /Words on each of the last 10 days/ });
  const box = await chart.boundingBox();
  if (box === null) throw new Error('The history chart has no box.');
  await chart.hover({ position: { x: 2, y: box.height - 2 } });
  const firstDay = await bars.first().getAttribute('data-day');
  await expect(readout).toHaveText(`${firstDay}: 0 words`);
  await chart.hover({ position: { x: box.width - 2, y: box.height - 2 } });
  const lastDay = await bars.last().getAttribute('data-day');
  await expect(readout).toHaveText(`${lastDay}: 0 words`);
  await page.getByRole('button', { name: 'Hide the history' }).hover();
  await expect(readout).toHaveText('Point at a bar to read its day and words.');

  const sprint = page.getByRole('region', { name: 'Sprint timer' });
  await sprint.getByRole('button', { name: 'Start sprint' }).click();
  await sprint.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Stopped.' })).toHaveCount(1);
});

test('a sprint that runs out is announced once as time up, through the status region', async ({ page }) => {
  // The clock is installed before the page loads, and frozen once the project is open, so the sprint runs only when the test moves it.
  await page.clock.install();
  await createProject(page, 'Sprint Clock');
  await freezeClock(page);

  const sprint = page.getByRole('region', { name: 'Sprint timer' });
  await sprint.getByRole('combobox', { name: 'Sprint length in minutes' }).selectOption('5');
  await sprint.getByRole('button', { name: 'Start sprint' }).click();
  await expect(sprint.getByTestId('sprint-reading')).toContainText('5:00');

  await page.clock.runFor(4 * 60_000);
  await expect(page.getByRole('status').filter({ hasText: 'Time is up.' })).toHaveCount(0);

  await page.clock.runFor(60_000 + 1_000);
  await expect(sprint.getByTestId('sprint-reading')).toContainText('Time is up.');
  await expect(page.getByRole('status').filter({ hasText: 'Time is up.' })).toHaveCount(1);
});

test('while a sitting is open, History’s Today and today’s bar agree with the status line', async ({ page }) => {
  await createProject(page, 'Sitting Words');
  await page.getByRole('button', { name: 'Create Chapter 1' }).click();
  await page.getByRole('toolbar', { name: 'Binder actions' }).getByRole('button', { name: 'New document' }).click();
  await page.getByRole('textbox', { name: 'Rename Untitled' }).fill('Sitting');
  await page.keyboard.press('Enter');
  // Twenty words, typed in this sitting, which has not ended.
  await page.getByRole('textbox', { name: 'Document text' }).fill(
    'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty.',
  );
  await expect(page.getByText('20 words today', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Show the history' }).click();
  const today = page.getByTestId('history-stats').locator('div', { has: page.locator('dt', { hasText: 'Today' }) }).locator('dd');
  await expect(today).toHaveText('20 words');
  const bars = page.getByRole('list', { name: /Words on each of the last 10 days/ }).locator('li');
  await expect(bars.last()).toContainText(/\d{4}-\d{2}-\d{2}: 20 words/);
});
