import { expect, test } from '@playwright/test';

import { createProject, waitForSaved } from './support.js';

/**
 * The daily target's notice (goals-progress §2.1): the writing that crosses today's target says so once, in the status line, and
 * writing short of it says nothing. The progress itself is the session ring's line, which the editor's status bar shows.
 */

test('the daily target is announced when today’s words reach it, and not before', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByTestId('settings');
  await settings.getByRole('button', { name: 'Writing' }).click();
  await settings.getByLabel('Daily target, in words (0 for none)').fill('300');
  await settings.getByRole('button', { name: 'Save writing settings' }).click();
  await expect(settings.getByText(/Saved\. The save delay/)).toBeVisible();
  await settings.getByRole('button', { name: 'Close' }).click();

  await createProject(page, 'Target Notice');
  await page.getByRole('button', { name: 'Create Chapter 1' }).click();
  await page.getByRole('toolbar', { name: 'Binder actions' }).getByRole('button', { name: 'New document' }).click();
  await page.getByRole('textbox', { name: 'Rename Untitled' }).fill('The Landing');
  await page.keyboard.press('Enter');

  const notice = page.locator('.status-line', { hasText: 'Today’s target is met.' });
  const words = (count: number): string => Array.from({ length: count }, (_, index) => `word${index}`).join(' ');
  await page.getByRole('textbox', { name: 'Document text' }).fill(words(299));
  await waitForSaved(page);
  await expect(page.getByTestId('session-target')).toContainText('299 / 300 words today');
  await expect(page.getByTestId('session-target')).not.toContainText('Today’s target is met.');
  await expect(notice).toHaveCount(0);

  await page.getByRole('textbox', { name: 'Document text' }).fill(words(300));
  await waitForSaved(page);
  await expect(page.getByTestId('session-target')).toContainText('300 / 300 words today');
  // The met state is said in the status bar's own text too, not only by the ring's colour (WCAG 1.4.1).
  await expect(page.getByTestId('session-target')).toContainText('Today’s target is met.');
  await expect(notice).toBeVisible();
});

test('the editor quick-set saves the daily target: the status line and the footer show it, Settings reads it, and a reload keeps it', async ({
  page,
}) => {
  await createProject(page, 'Quick Target');
  await page.getByRole('button', { name: 'Create Chapter 1' }).click();
  await page.getByRole('toolbar', { name: 'Binder actions' }).getByRole('button', { name: 'New document' }).click();
  await page.getByRole('textbox', { name: 'Rename Untitled' }).fill('The Landing');
  await page.keyboard.press('Enter');

  // With no target set, the status line is the quick-set's button, and the button says how to set one.
  const status = page.getByTestId('session-target');
  await status.getByRole('button', { name: /words today/ }).click();
  const quick = page.getByRole('form', { name: 'Daily target' });
  const field = quick.getByLabel('Daily target, in words (0 for none)');

  // A value that is not a whole number of words is refused beside the field, in the quick-set's own words.
  await field.fill('1.5');
  await quick.getByRole('button', { name: 'Save target' }).click();
  await expect(quick.getByRole('alert')).toContainText('whole number of words from 0 to 100,000');

  // 1,234 is not a multiple of 50, which the native step would refuse; the quick-set takes any whole number.
  await field.fill('1234');
  await quick.getByRole('button', { name: 'Save target' }).click();
  await expect(quick).toHaveCount(0);
  await expect(status).toContainText('0 / 1,234 words today');
  // The button names the form it opens only while the form is there, so it names no missing element once the form has closed.
  await expect(status.getByRole('button')).not.toHaveAttribute('aria-controls');
  await expect(page.getByTestId('binder-totals')).toContainText('0 / 1,234 words today');

  // The setting is kept, so Settings reads the same target.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByTestId('settings');
  await settings.getByRole('button', { name: 'Writing' }).click();
  await expect(settings.getByLabel('Daily target, in words (0 for none)')).toHaveValue('1234');
  await settings.getByRole('button', { name: 'Close' }).click();

  // And it is still there after a reload: the footer shows it, and Settings reads it back.
  await waitForSaved(page);
  await page.reload();
  await page.locator('.project-row', { hasText: 'Quick Target' }).getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('tree', { name: 'Binder' })).toBeVisible();
  await expect(page.getByTestId('binder-totals')).toContainText('0 / 1,234 words today');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const reloaded = page.getByTestId('settings');
  await reloaded.getByRole('button', { name: 'Writing' }).click();
  await expect(reloaded.getByLabel('Daily target, in words (0 for none)')).toHaveValue('1234');
});
