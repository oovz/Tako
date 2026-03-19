import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MANGADEX_LIVE_DOMAIN = process.env.TMD_TEST_MANGADEX_DOMAIN ?? 'mangadex.org';
process.env.TMD_TEST_MANGADEX_DOMAIN = MANGADEX_LIVE_DOMAIN;
process.env.TMD_TEST_E2E_USE_MOCKS = 'false';
process.env.TMD_TEST_E2E_ALLOW_NETWORK = 'true';

export default defineConfig({
  testDir: path.resolve(__dirname, 'tests/live'),
  fullyParallel: false, // Run sequentially to avoid rate limiting
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1, // More retries for live tests
  workers: 1, // Single worker to avoid rate limiting
  reporter: [['list']],
  timeout: 120_000, // Longer timeout for real network requests
  expect: { timeout: 15_000 },
  use: {
    // Extension testing requires headed mode - configured in fixture
    trace: 'on-first-retry',
    // Prevent browser windows from grabbing focus during tests
    launchOptions: {
      args: ['--no-focus-on-launch', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
    }
  },
  // Ensure the extension is built before running live tests
  globalSetup: path.resolve(__dirname, 'tests/e2e/global-setup.ts'),
  projects: [
    {
      name: 'live-metadata',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium'
      }
    }
  ]
});
