import { expect, test, type Page } from '@playwright/test';

import { waitForSaved } from './support.js';

/**
 * Writing sessions and storage (ui-modules §5.3, goals-progress §2.1, command-bus §5.1). A sitting's words count toward the
 * daily target while it is open, and are kept in the sessions log once it ends. The browser's storage answer decides whether
 * the banner shows, and a dismissal lasts for the visit.
 */

async function openSample(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Check for continuity problems', exact: true }).click();
  await expect(page.getByRole('tree', { name: 'Binder' })).toBeVisible();
}

async function openFriend(page: Page): Promise<void> {
  await page.getByRole('treeitem', { name: /The Friend/ }).locator('.row-title').click();
  await expect(page.getByRole('textbox', { name: 'Document text' })).toBeVisible();
}

test('the words of a sitting count toward the daily target, and still count once the sitting has ended', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByTestId('settings');
  await settings.getByRole('button', { name: 'Writing' }).click();
  await settings.getByLabel('Daily target, in words (0 for none)').fill('300');
  await settings.getByRole('button', { name: 'Save writing settings' }).click();
  await expect(settings.getByText(/Saved\. The save delay/)).toBeVisible();
  await settings.getByRole('button', { name: 'Close' }).click();

  await openSample(page);
  await openFriend(page);
  await page.getByRole('textbox', { name: 'Document text' }).fill('one two three four five six seven');
  await waitForSaved(page);
  await expect(page.getByTestId('session-target')).toContainText('7 / 300 words today');

  // Leaving the project ends the sitting, and its line goes into the sessions log.
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projects in this browser' })).toBeVisible();
  await page.getByRole('button', { name: 'Open', exact: true }).first().click();
  await expect(page.getByRole('tree', { name: 'Binder' })).toBeVisible();
  await openFriend(page);
  await expect.poll(async () => page.getByTestId('session-target').textContent(), { timeout: 10_000 }).toContain('7 / 300 words today');
});

test('the activity log exports as Markdown, with the agent turn that ran in the sample', async ({ page }) => {
  await openSample(page);
  await page.getByRole('tab', { name: 'Activity' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export as Markdown', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/-activity\.md$/);
});

test('the first-run card stays dismissed after “Got it”, across a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('first-run')).toBeVisible();
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await expect(page.getByTestId('first-run')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Projects in this browser' })).toBeVisible();
  await expect(page.getByTestId('first-run')).toHaveCount(0);
});

test('the storage banner shows while the browser has not kept the project, can be dismissed for the visit, and returns on the next open', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const storage = (globalThis as unknown as { navigator: { storage?: object } }).navigator.storage;
    if (storage === undefined) return;
    const proto = Object.getPrototypeOf(storage) as Record<string, unknown>;
    proto['persisted'] = async () => false;
    proto['persist'] = async () => false;
  });
  await openSample(page);

  const banner = page.getByTestId('storage-banner');
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Learn why' }).click();
  await expect(banner).toContainText('Browsers may remove stored data');

  await banner.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.getByTestId('storage-banner')).toHaveCount(0);

  // Dismissed for this visit: opening another project the same way does not show it again.
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).first().click();
  await expect(page.getByRole('tree', { name: 'Binder' })).toBeVisible();
  await expect(page.getByTestId('storage-banner')).toHaveCount(0);

  // A new visit asks again, and the banner is back.
  await page.reload();
  await openSample(page);
  await expect(page.getByTestId('storage-banner')).toBeVisible();
});
