import { expect, test } from '@playwright/test';

import { createProject, waitForSaved } from './support.js';

/**
 * epub-metadata.md and ui-modules §5: the project's name opens the project panel, where the title, the author, the
 * language, the ISBN and the cover are set. Each field saves on its own, a refused value is said beside its field, and
 * nothing is written for a refusal.
 */

test('the project name opens the panel, which saves the author and refuses an ISBN with a bad check digit', async ({ page }) => {
  await createProject(page, 'Panel Book');
  await page.getByRole('button', { name: 'Panel Book' }).click();
  const panel = page.getByRole('dialog', { name: 'Project' });
  await expect(panel).toBeVisible();

  await panel.getByRole('textbox', { name: 'Author' }).fill('Ada Writer');
  await panel.getByRole('textbox', { name: 'Author' }).press('Enter');
  await expect(panel.getByRole('alert')).toHaveCount(0);

  await panel.getByRole('textbox', { name: 'ISBN' }).fill('978-0-306-40615-8');
  await panel.getByRole('textbox', { name: 'ISBN' }).press('Enter');
  await expect(panel.getByRole('alert')).toContainText('check digit');

  await panel.getByRole('textbox', { name: 'ISBN' }).fill('978-0-306-40615-7');
  await panel.getByRole('textbox', { name: 'ISBN' }).press('Enter');
  await expect(panel.getByRole('alert')).toHaveCount(0);

  await panel.getByRole('button', { name: 'Done' }).click();
  await expect(panel).toHaveCount(0);
  await waitForSaved(page);

  // Reopened, the panel shows what was saved: the author, and the ISBN as its digits.
  await page.getByRole('button', { name: 'Panel Book' }).click();
  await expect(page.getByRole('textbox', { name: 'Author' })).toHaveValue('Ada Writer');
  await expect(page.getByRole('textbox', { name: 'ISBN' })).toHaveValue('9780306406157');
});

test('a title typed in the panel renames the project in the toolbar', async ({ page }) => {
  await createProject(page, 'Working Title');
  await page.getByRole('button', { name: 'Working Title' }).click();
  const panel = page.getByRole('dialog', { name: 'Project' });
  // Exact: the Author field's help text also says "title", so a substring match would find two fields.
  await panel.getByRole('textbox', { name: 'Title', exact: true }).fill('The Lantern Keeper');
  await panel.getByRole('textbox', { name: 'Title', exact: true }).press('Enter');
  await panel.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('The Lantern Keeper');
});

test('a language that is not a language tag is refused beside its field, and the old one stays', async ({ page }) => {
  await createProject(page, 'Language Book');
  await page.getByRole('button', { name: 'Language Book' }).click();
  const panel = page.getByRole('dialog', { name: 'Project' });
  await panel.getByRole('textbox', { name: 'Language' }).fill('not a language tag!');
  await panel.getByRole('textbox', { name: 'Language' }).press('Enter');
  await expect(panel.getByRole('alert')).toContainText('language tag');
  await panel.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Language Book' }).click();
  await expect(page.getByRole('textbox', { name: 'Language' })).toHaveValue('en');
});

test('Escape keeps the author the writer typed: the focused field saves before the panel closes', async ({ page }) => {
  await createProject(page, 'Escape Book');
  await page.getByRole('button', { name: 'Escape Book' }).click();
  const panel = page.getByRole('dialog', { name: 'Project' });
  await panel.getByRole('textbox', { name: 'Author' }).fill('Escaped Author');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await waitForSaved(page);

  await page.getByRole('button', { name: 'Escape Book' }).click();
  await expect(page.getByRole('textbox', { name: 'Author' })).toHaveValue('Escaped Author');
});

test('Escape does not drop a value the command refused: the panel closes, and the status line says which field was not saved', async ({
  page,
}) => {
  await createProject(page, 'Refused Book');
  await page.getByRole('button', { name: 'Refused Book' }).click();
  const panel = page.getByRole('dialog', { name: 'Project' });
  await panel.getByRole('textbox', { name: 'Language' }).fill('not a language tag!');
  await page.keyboard.press('Escape');

  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'Language was not saved' })).toContainText('language tag');
  // The refused value was not written, so the old one is what the panel shows next.
  await page.getByRole('button', { name: 'Refused Book' }).click();
  await expect(page.getByRole('textbox', { name: 'Language' })).toHaveValue('en');
});

test('Done with a refused value closes the panel, and the status line says which field was not saved', async ({ page }) => {
  await createProject(page, 'Done Refused');
  await page.getByRole('button', { name: 'Done Refused' }).click();
  const panel = page.getByRole('dialog', { name: 'Project' });
  await panel.getByRole('textbox', { name: 'Language' }).fill('not a language tag!');
  await panel.getByRole('button', { name: 'Done' }).click();

  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'Language was not saved' })).toContainText('language tag');
});

test('closing the panel returns focus to the project name that opened it', async ({ page }) => {
  await createProject(page, 'Focus Book');
  const name = page.getByRole('button', { name: 'Focus Book' });
  await name.click();
  const panel = page.getByRole('dialog', { name: 'Project' });
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(name).toBeFocused();
});

test('the cover picker is not a Tab stop: Tab from Choose cover goes straight to Done', async ({ page }) => {
  await createProject(page, 'Tab Book');
  await page.getByRole('button', { name: 'Tab Book' }).click();
  const panel = page.getByRole('dialog', { name: 'Project' });
  await panel.getByRole('button', { name: /Choose cover/ }).focus();
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: 'Done' })).toBeFocused();
  await expect(panel.getByLabel('Cover image file')).toBeHidden();
});
