import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Non-live E2E policy: default to deterministic mock routes/fixtures.
process.env.TMD_TEST_E2E_USE_MOCKS = process.env.TMD_TEST_E2E_USE_MOCKS ?? 'true';
process.env.TMD_TEST_E2E_ALLOW_NETWORK = 'false';

export default defineConfig({
  testDir: path.resolve(__dirname, 'tests/e2e'),
  testMatch: ['**/*.spec.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 10_000 },
  globalSetup: path.resolve(__dirname, 'tests/e2e/global-setup.ts'),
  use: {
    // Extension testing requires headed mode - configured in fixture
    trace: 'on-first-retry',
    // Prevent browser windows from grabbing focus during tests
    launchOptions: {
      args: ['--no-focus-on-launch', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
    }
  },
  projects: [
    // Deterministic E2E extension tests backed by fixture mock routes.
    {
      name: 'e2e',
      use: {
        ...devices['Desktop Chrome'],
      }
    }
  ],
});
