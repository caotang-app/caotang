import { expect, test, type Page } from '@playwright/test';

/**
 * The agent drawer's toggle names the body it opens only while the body is rendered (WAI-ARIA disclosure): a closed drawer has no
 * element with the body's id, so `aria-controls` is left off, and it names the body once the body is on screen.
 */

/** The sample project, opened by the first-run card's read-only demo. Opening a project shows the agent drawer. */
async function openSample(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Check for continuity problems', exact: true }).click();
  await expect(page.getByRole('tree', { name: 'Binder' })).toBeVisible();
}

test('the agent toggle names its body only while the body is on screen', async ({ page }) => {
  await page.goto('/');
  await openSample(page);
  const toggle = page.locator('.agent-toggle');

  // Open: the body is rendered, and the toggle names it.
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAttribute('aria-controls', 'agent-body');
  await expect(page.locator('#agent-body')).toBeVisible();

  // Closed: the body is not rendered, so the toggle names nothing.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).not.toHaveAttribute('aria-controls', /.*/);
  await expect(page.locator('#agent-body')).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-controls', 'agent-body');
});
