import { defineConfig, devices } from "@playwright/test"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Deterministic tests use fixtures and block external network access.
process.env.TMD_TEST_E2E_USE_MOCKS =
  process.env.TMD_TEST_E2E_USE_MOCKS ?? "true"
process.env.TMD_TEST_E2E_ALLOW_NETWORK = "false"

export default defineConfig({
  testDir: path.resolve(__dirname, "tests/e2e"),
  testMatch: ["**/*.spec.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 8,
  reporter: [["list"]],
  timeout: 90_000,
  expect: { timeout: 10_000 },
  globalSetup: path.resolve(__dirname, "tests/e2e/global-setup.ts"),
  use: {
    locale: "en-US",
    // Run the extension tests headed; CI supplies Xvfb.
    headless: false,
    // Retain failure evidence even when retries are disabled.
    trace: "retain-on-failure",
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
  projects: [
    {
      name: "e2e",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
})
