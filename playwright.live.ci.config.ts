import { defineConfig, devices } from "@playwright/test"
import path from "node:path"
import { fileURLToPath } from "node:url"
import liveConfig from "./playwright.live.config"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  ...liveConfig,
  // Keep the CI canary limited to public API requests.
  projects: [
    {
      name: "mangadex-canary",
      testDir: path.resolve(__dirname, "tests/live/mangadex"),
      testMatch: ["api-contract.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
      },
    },
  ],
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  reporter: [["line"]],
})
