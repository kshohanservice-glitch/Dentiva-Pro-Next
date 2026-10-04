import { defineConfig } from '@playwright/test';

/**
 * Electron E2E — runs the real app (main + renderer) via Playwright's
 * Electron launcher. No browser download is required; `npm run test:e2e`
 * builds first, then this config executes tests/e2e serially against a
 * single app instance (Electron single-instance lock).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'test-results',
  use: {},
});
