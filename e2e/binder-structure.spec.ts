import { expect, test } from '@playwright/test';

import { EMPTY_STATE_INTENTS } from '../apps/desktop/src/app/empty-intents.js';

import { binderRow, createProject } from './support.js';

/**
 * The empty manuscript's two next steps (ui-modules §2.4): Create Chapter 1 makes the first chapter, and Let the agent structure it
 * starts the agent on the restructure intent, so the writer reads a plan before anything changes.
 */

test('an empty manuscript offers to let the agent structure it, and the offer starts the restructure intent in the agent panel', async ({
  page,
}) => {
  await createProject(page, 'Structure Book');
  const actions = page.getByRole('button', { name: 'Let the agent structure it', exact: true });
  await expect(actions).toBeVisible();

  await actions.click();
  await expect(page.getByTestId('agent-panel')).toHaveClass(/is-open/);
  await expect(page.locator('.agent-intent-text', { hasText: EMPTY_STATE_INTENTS.restructure })).toBeVisible();
});

test('Create Chapter 1 makes the first chapter, and the agent offer is gone once the manuscript has a child', async ({ page }) => {
  await createProject(page, 'Chapter Book');
  await page.getByRole('button', { name: 'Create Chapter 1' }).click();
  await expect(page.getByRole('button', { name: 'Let the agent structure it', exact: true })).toHaveCount(0);
  await expect(binderRow(page, 'Chapter 1')).toBeVisible();
});
