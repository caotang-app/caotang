import { expect, test } from '@playwright/test';

import { createProject } from './support.js';

/**
 * Settings › Context (ui-modules §5.2, context-assembly §5): the section's link shows the prompt a scene draft would send, under the
 * budgets the writer typed. The link needs the project in view, so it is there inside a project and not on the projects screen.
 */

test('inside a project, the Context section offers the prompt for a scene, and the link opens and closes it', async ({ page }) => {
  await createProject(page, 'Context Book');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByTestId('settings');
  await settings.getByRole('button', { name: 'Context', exact: true }).click();

  const show = settings.getByRole('button', { name: 'See the prompt for a scene', exact: true });
  await expect(show).toBeVisible();
  await show.click();
  await expect(settings.getByRole('button', { name: 'Hide the prompt for a scene', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await settings.getByRole('button', { name: 'Hide the prompt for a scene', exact: true }).click();
  await expect(show).toHaveAttribute('aria-expanded', 'false');
});

test('on the projects screen there is no project to preview, so the Context section has no prompt link', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByTestId('settings');
  await settings.getByRole('button', { name: 'Context', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'See the prompt for a scene', exact: true })).toHaveCount(0);
});
