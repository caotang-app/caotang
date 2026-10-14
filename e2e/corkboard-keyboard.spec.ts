import { expect, test, type Page } from '@playwright/test';

import { card, countOf, createProject } from './support.js';

/**
 * ui-modules §0.4 and §3.2: a corkboard card takes focus from the keyboard. One card holds the roving focus, so one card is in the
 * tab order; the arrow keys move the focus along the board; and Alt+arrow moves the focused card, as one `binder.move` per move, with
 * the focus staying on that card.
 */

/** A chapter opened on the corkboard, holding the cards named, in order. */
async function boardWith(page: Page, titles: readonly string[]): Promise<void> {
  await createProject(page, 'Keyboard Board');
  await page.getByRole('button', { name: 'Create Chapter 1' }).click();
  for (const title of titles) {
    await page.locator('.corkboard-head').getByRole('button', { name: 'New card' }).click();
    await page.getByRole('textbox', { name: 'Rename Untitled' }).fill(title);
    await page.keyboard.press('Enter');
    await expect(card(page, title)).toBeVisible();
  }
}

test('one card is in the tab order, and the arrow keys move the focus along the board', async ({ page }) => {
  await boardWith(page, ['First', 'Second', 'Third']);

  await card(page, 'First').focus();
  await expect(card(page, 'First')).toBeFocused();
  await expect(card(page, 'First')).toHaveAttribute('tabindex', '0');
  await expect(card(page, 'Second')).toHaveAttribute('tabindex', '-1');

  await page.keyboard.press('ArrowRight');
  await expect(card(page, 'Second')).toBeFocused();
  await expect(card(page, 'Second')).toHaveAttribute('tabindex', '0');
  await expect(card(page, 'First')).toHaveAttribute('tabindex', '-1');

  await page.keyboard.press('ArrowDown');
  await expect(card(page, 'Third')).toBeFocused();

  // The first card is the end of the board for the arrow keys: Left from it moves nowhere.
  await card(page, 'First').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(card(page, 'First')).toBeFocused();
});

test('Alt+ArrowDown moves the focused card one place down, as one binder.move, and the card keeps the focus', async ({ page }) => {
  await boardWith(page, ['First', 'Second', 'Third']);
  const before = await countOf(page, 'binder.move');

  await card(page, 'First').focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('.cards .card-title')).toHaveText(['Second', 'First', 'Third']);
  await expect(card(page, 'First')).toBeFocused();
  expect(await countOf(page, 'binder.move')).toBe(before + 1);

  // And back up: the card returns to the top, and the focus is still on it.
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.locator('.cards .card-title')).toHaveText(['First', 'Second', 'Third']);
  await expect(card(page, 'First')).toBeFocused();
  expect(await countOf(page, 'binder.move')).toBe(before + 2);
});

test('Alt+ArrowUp on the first card moves nothing and writes no command', async ({ page }) => {
  await boardWith(page, ['First', 'Second']);
  const before = await countOf(page, 'binder.move');

  await card(page, 'First').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.locator('.cards .card-title')).toHaveText(['First', 'Second']);
  expect(await countOf(page, 'binder.move')).toBe(before);
});

test('Enter and Space select the focused card, as a click does', async ({ page }) => {
  await boardWith(page, ['First', 'Second']);

  await card(page, 'Second').focus();
  await page.keyboard.press('Enter');
  await expect(card(page, 'Second')).toHaveClass(/is-selected/);
  await expect(card(page, 'First')).not.toHaveClass(/is-selected/);

  await card(page, 'First').focus();
  await page.keyboard.press(' ');
  await expect(card(page, 'First')).toHaveClass(/is-selected/);
  await expect(card(page, 'Second')).not.toHaveClass(/is-selected/);
});

test('F2 renames the focused card in place, and Escape leaves the title as it was', async ({ page }) => {
  await boardWith(page, ['First', 'Second']);

  await card(page, 'Second').focus();
  await page.keyboard.press('F2');
  const field = page.getByRole('textbox', { name: 'Rename Second' });
  await expect(field).toBeFocused();
  await field.fill('Renamed');
  await page.keyboard.press('Enter');
  await expect(page.locator('.cards .card-title')).toHaveText(['First', 'Renamed']);

  await card(page, 'First').focus();
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: 'Rename First' }).fill('Discarded');
  await page.keyboard.press('Escape');
  await expect(page.locator('.cards .card-title')).toHaveText(['First', 'Renamed']);
});

test('Shift+F10 opens the focused card’s menu, which moves the card, and Escape returns the focus to the card', async ({ page }) => {
  await boardWith(page, ['First', 'Second', 'Third']);
  const before = await countOf(page, 'binder.move');

  await card(page, 'First').focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Actions for First' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeFocused();

  await menu.getByRole('menuitem', { name: 'Move down' }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('.cards .card-title')).toHaveText(['Second', 'First', 'Third']);
  expect(await countOf(page, 'binder.move')).toBe(before + 1);

  await card(page, 'First').focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu', { name: 'Actions for First' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Actions for First' })).toHaveCount(0);
  await expect(card(page, 'First')).toBeFocused();
});

test('a space typed in a card’s synopsis is typed there, and does not select the card', async ({ page }) => {
  await boardWith(page, ['First', 'Second']);
  const synopsis = card(page, 'First').locator('textarea');
  await synopsis.click();
  await page.keyboard.type('two words');
  await expect(synopsis).toHaveValue('two words');
});

test('Delete on a focused card asks through the binder’s confirm, and confirming removes the card', async ({ page }) => {
  await boardWith(page, ['First', 'Second', 'Third']);

  await card(page, 'Second').focus();
  await page.keyboard.press('Delete');
  const confirm = page.getByRole('dialog', { name: 'Delete “Second”?' });
  await expect(confirm).toBeVisible();
  // Asking is not deleting: the card stays until the writer confirms.
  await expect(card(page, 'Second')).toHaveCount(1);

  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.locator('.cards .card-title')).toHaveText(['First', 'Third']);
});

test('the card menu’s Delete asks through the same confirm, and cancelling keeps the card', async ({ page }) => {
  await boardWith(page, ['First', 'Second']);

  await card(page, 'Second').focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menu', { name: 'Actions for Second' }).getByRole('menuitem', { name: 'Delete…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete “Second”?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.locator('.cards .card-title')).toHaveText(['First', 'Second']);
});

test('after a keyboard delete on the board is confirmed, focus goes to the next card, or to the previous one at the end', async ({
  page,
}) => {
  await boardWith(page, ['First', 'Second', 'Third']);

  await card(page, 'Second').focus();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('dialog', { name: 'Delete “Second”?' })).toBeVisible();
  // The keyboard path: Tab from Cancel to Delete, and Enter confirms.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(card(page, 'Second')).toHaveCount(0);
  await expect(card(page, 'Third')).toBeFocused();

  // The last card has no next one, so the card before it takes the focus.
  await page.keyboard.press('Delete');
  await expect(page.getByRole('dialog', { name: 'Delete “Third”?' })).toBeVisible();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(card(page, 'Third')).toHaveCount(0);
  await expect(card(page, 'First')).toBeFocused();
});
