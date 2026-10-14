import { expect, test, type Page } from '@playwright/test';

import { createProject, waitForSaved } from './support.js';

/**
 * project-format §2 and ui-modules §2.2: a status or label is the writer's to add. A project starts with no label, so the
 * picker's "+ Add" entry is how the first one is made, and the vocabulary editor is where it is renamed or removed.
 */

/** A chapter with one scene in it, saved: a document the inspector shows, and a status and label can be set on. */
async function sceneInChapter(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Create Chapter 1' }).click();
  await page.getByRole('toolbar', { name: 'Binder actions' }).getByRole('button', { name: 'New document' }).click();
  await page.getByRole('textbox', { name: 'Rename Untitled' }).fill('The Landing');
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Document text' }).fill('The boat came in with the tide.');
  await waitForSaved(page);
}

test('Done and Escape return focus to the label picker the editor was opened from', async ({ page }) => {
  await createProject(page, 'Focus Vocabulary');
  await sceneInChapter(page);
  const chip = page.getByRole('button', { name: /^Label: No label\. Change label/ });

  await chip.click();
  await page.getByRole('menuitem', { name: '+ Add label…' }).click();
  const editor = page.getByRole('dialog', { name: 'Statuses and labels' });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Done' }).click();
  await expect(editor).toHaveCount(0);
  await expect(chip).toBeFocused();

  await chip.click();
  await page.getByRole('menuitem', { name: '+ Add label…' }).click();
  await expect(editor).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(chip).toBeFocused();
});

test('the first label is added from the inspector picker, and it is set on the scene', async ({ page }) => {
  await createProject(page, 'Label Book');
  await sceneInChapter(page);

  await page.getByRole('button', { name: /^Label: No label\. Change label/ }).click();
  await page.getByRole('menuitem', { name: '+ Add label…' }).click();
  const editor = page.getByRole('dialog', { name: 'Statuses and labels' });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Labels', exact: true }).click();
  await editor.getByRole('textbox', { name: 'New label' }).fill('Act 1');
  await editor.getByRole('button', { name: 'Add label' }).click();
  await expect(editor.getByRole('textbox', { name: 'Name of Act 1' })).toBeVisible();
  await editor.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: /^Label: No label\. Change label/ }).click();
  // A term the picker lists is a checkable item, so it is a menuitemradio, not a menuitem.
  await page.getByRole('menuitemradio', { name: 'Act 1' }).click();
  await expect(page.getByRole('button', { name: /^Label: Act 1\. Change label/ })).toBeVisible();
});

test('a label removed in the editor is taken off the scene that held it, and the undo puts it back', async ({ page }) => {
  await createProject(page, 'Remove Label');
  await sceneInChapter(page);

  // Make a label, and set it on the scene, through the same picker a writer uses.
  await page.getByRole('button', { name: /^Label: No label\. Change label/ }).click();
  await page.getByRole('menuitem', { name: '+ Add label…' }).click();
  const editor = page.getByRole('dialog', { name: 'Statuses and labels' });
  await editor.getByRole('button', { name: 'Labels', exact: true }).click();
  await editor.getByRole('textbox', { name: 'New label' }).fill('Draft pass');
  await editor.getByRole('button', { name: 'Add label' }).click();
  await editor.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: /^Label: No label\. Change label/ }).click();
  await page.getByRole('menuitemradio', { name: 'Draft pass' }).click();
  await expect(page.getByRole('button', { name: /^Label: Draft pass\. Change label/ })).toBeVisible();

  // Remove it in the editor: the scene loses it, and the activity row says so.
  await page.getByRole('button', { name: /^Label: Draft pass\. Change label/ }).click();
  await page.getByRole('menuitem', { name: '+ Add label…' }).click();
  const again = page.getByRole('dialog', { name: 'Statuses and labels' });
  await again.getByRole('button', { name: 'Labels', exact: true }).click();
  await again.getByRole('button', { name: 'Remove' }).first().click();
  await again.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: /^Label: No label\. Change label/ })).toBeVisible();

  await page.getByRole('tab', { name: 'Activity' }).click();
  const latest = page.getByRole('list', { name: 'Activity' }).getByRole('listitem').first();
  await expect(latest.locator('.activity-title')).toHaveText('Status or label removed');
  await expect(latest.getByRole('button', { name: 'Undo' })).toBeVisible();
  await latest.getByRole('button', { name: 'Undo' }).click();

  // The undo restored the term and the scene's label together, so the chip shows the label again.
  await expect(page.getByRole('button', { name: /^Label: Draft pass\. Change label/ })).toBeVisible();
});
