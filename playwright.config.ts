import { defineConfig, devices } from '@playwright/test';

// One port for the dev server and the suite. CAOTANG_E2E_PORT gives a parallel checkout its
// own server; with it set, an existing server is never reused, because on a shared machine
// the one already listening may be another checkout's build of the app.
const port = Number(process.env['CAOTANG_E2E_PORT'] ?? 5173);
const isolated = process.env['CAOTANG_E2E_PORT'] !== undefined;

// The production preview has its own port, derived from the dev port (a thousand above it), so two checkouts
// running their suites at once never share a preview server. CAOTANG_E2E_PREVIEW_PORT overrides it.
const previewPort = Number(process.env['CAOTANG_E2E_PREVIEW_PORT'] ?? port + 1000);

/**
 * E2E wiring. Browsers are installed on demand with
 * `pnpm exec playwright install chromium`, once per machine, not every run.
 *
 * Two projects. `chromium` runs the suite against the dev server. `production-preview` runs only
 * e2e/prod-smoke.spec.ts against `vite preview` of a fresh build, so a build-only failure (a root-absolute asset path, a
 * DEV-only hook) is caught here and not by a writer. The preview server builds before it starts, so it tests the source
 * this checkout holds.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /prod-smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'production-preview',
      testMatch: /prod-smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${previewPort}` },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @caotang/desktop dev',
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: !process.env.CI && !isolated,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @caotang/desktop build && pnpm --filter @caotang/desktop preview',
      url: `http://127.0.0.1:${previewPort}`,
      env: { ...process.env, CAOTANG_E2E_PREVIEW_PORT: String(previewPort) },
      reuseExistingServer: !process.env.CI && !isolated,
      timeout: 240_000,
    },
  ],
});
