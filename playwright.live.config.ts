import { defineConfig, devices } from "@playwright/test"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.TMD_TEST_E2E_USE_MOCKS = "false"
process.env.TMD_TEST_E2E_ALLOW_NETWORK = "true"
process.env.TMD_TEST_E2E_LIVE = "true"

export default defineConfig({
  testDir: path.resolve(__dirname, "tests/live"),
  fullyParallel: false, // Run sequentially to avoid rate limiting
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 3 : 0, // Retry up to 3 times in CI for transient network failures
  workers: 1, // Single worker to avoid rate limiting
  reporter: [["list"]],
  // Heavy download cases may legitimately wait through the 150s application
  // hard timeout plus diagnostics. Keep the enclosing test timeout larger.
  timeout: 240_000,
  expect: { timeout: 10_000 },
  use: {
    locale: "en-US",
    // Live browser extraction needs the same headed extension context as the
    // deterministic suite. CI supplies Xvfb.
    headless: false,
    // Extension testing requires headed mode - configured in fixture
    trace: "on-first-retry",
    // Prevent browser windows from grabbing focus during tests
    launchOptions: {
      args: [
        "--no-focus-on-launch",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--lang=en-US",
      ],
    },
  },
  // Ensure the extension is built before running live tests
  globalSetup: path.resolve(__dirname, "tests/e2e/global-setup.ts"),
  projects: [
    {
      name: "live-metadata",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium-tip-of-tree",
      },
    },
  ],
})
