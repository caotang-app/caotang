import { readFileSync, writeFileSync } from 'node:fs';

import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { ZIP_ENGINE } from '../packages/store/src/index.js';

import { binderRow, bodyOf, createProject, hasTitle, idOf, waitForSaved } from './support.js';

/**
 * project-format §5, through the app: a bundle whose `caotang.json` will not load is offered its recovery, and nothing is written
 * until the writer says yes. The damaged bundles are the app's own export, changed on disk the way a damaged file is: the manifest
 * is cut short, and a copy of the good one is put beside it when the test says so.
 */

/** The bundle the app exports for the open project, as bytes. */
async function exportedBundle(page: Page): Promise<Uint8Array> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export bundle', exact: true }).click(),
  ]);
  const path = await download.path();
  return new Uint8Array(readFileSync(path ?? ''));
}

/** The bundle with its manifest cut short, and with or without an older good copy of the manifest beside it. */
async function damagedBundle(testInfo: TestInfo, bytes: Uint8Array, backup: boolean): Promise<string> {
  const { unzipSync, zipSync } = await ZIP_ENGINE.load();
  const entries = unzipSync(bytes);
  const good = entries['caotang.json'];
  if (good === undefined) throw new Error('the exported bundle has no caotang.json');
  if (backup) entries['caotang.json.bak.1'] = good;
  entries['caotang.json'] = new TextEncoder().encode('{"formatVersion": 1, "project": ');
  const path = testInfo.outputPath(`damaged-${backup ? 'with-backup' : 'bare'}.caotang`);
  writeFileSync(path, zipSync(entries));
  return path;
}

/** A project with one chapter and one scene carrying the given text, saved. */
async function bookWithScene(page: Page, name: string, text: string): Promise<void> {
  await createProject(page, name);
  await page.getByRole('button', { name: 'Create Chapter 1' }).click();
  await page.getByRole('toolbar', { name: 'Binder actions' }).getByRole('button', { name: 'New document' }).click();
  await page.getByRole('textbox', { name: 'Rename Untitled' }).fill('Opening');
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Document text' }).fill(text);
  await waitForSaved(page);
}

test('a bundle whose manifest will not load offers its backup copy, and opens it once the writer says so', async ({ page }, testInfo) => {
  await bookWithScene(page, 'Ladder Book', 'Words to keep.');
  const bundle = await exportedBundle(page);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projects in this browser' })).toBeVisible();

  await page.getByTestId('bundle-input').setInputFiles(await damagedBundle(testInfo, bundle, true));

  const dialog = page.getByRole('dialog', { name: 'Open an older copy of this project?' });
  await expect(dialog).toBeVisible();
  // The copy it would open is named, so the writer knows which backup it is.
  await expect(dialog).toContainText('caotang.json.bak.1');
  // A bundle is read, not changed: the copy kept is the bundle file itself, and the dialog says so.
  await expect(dialog).toContainText('The bundle file itself is not changed');
  await dialog.getByRole('button', { name: 'Open this copy' }).click();

  await expect(page.getByRole('heading', { name: 'Ladder Book', level: 1 })).toBeVisible();
  await expect(binderRow(page, 'Opening')).toBeVisible();
  expect(await bodyOf(page, await idOf(page, 'Opening'))).toContain('Words to keep.');
});

test('a bundle with no readable manifest copy is rebuilt only with a yes, and cancelling changes nothing', async ({ page }, testInfo) => {
  await bookWithScene(page, 'Rebuild Book', 'Rebuilt words.');
  const bundle = await exportedBundle(page);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projects in this browser' })).toBeVisible();
  const damaged = await damagedBundle(testInfo, bundle, false);
  // Every project row the writer has before the offer, by its text: a cancelled rebuild must leave exactly these.
  await expect(page.locator('.project-row').filter({ hasText: 'Rebuild Book' })).toHaveCount(1);
  const rowsBefore = await page.locator('.project-row').allInnerTexts();

  await page.getByTestId('bundle-input').setInputFiles(damaged);
  const dialog = page.getByRole('dialog', { name: 'Rebuild this project from its documents?' });
  await expect(dialog).toBeVisible();
  // A rebuild loses structure, and the dialog says so before it asks.
  await expect(dialog).toContainText('Folder structure');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Nothing was opened or changed.' })).toBeVisible();
  // Cancelling wrote nothing: the same rows are listed, and no rebuilt project is among them.
  await expect(page.locator('.project-row')).toHaveCount(rowsBefore.length);
  expect(await page.locator('.project-row').allInnerTexts()).toEqual(rowsBefore);

  await page.getByTestId('bundle-input').setInputFiles(damaged);
  await page
    .getByRole('dialog', { name: 'Rebuild this project from its documents?' })
    .getByRole('button', { name: 'Rebuild the project' })
    .click();

  // The rebuilt project is a new one with a placeholder name (project-format §5.2), and the scene comes back under the folder the
  // rebuild makes for documents it cannot place, with its text.
  await expect(page.getByRole('heading', { name: 'Recovered project', level: 1 })).toBeVisible();
  await expect.poll(() => hasTitle(page, 'Recovered')).toBe(true);
  await expect.poll(() => hasTitle(page, 'Opening')).toBe(true);
  expect(await bodyOf(page, await idOf(page, 'Opening'))).toContain('Rebuilt words.');
});
