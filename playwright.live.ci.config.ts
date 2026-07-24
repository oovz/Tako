import { defineConfig } from "@playwright/test"
import liveConfig from "./playwright.live.config"

export default defineConfig({
  ...liveConfig,
  // CI continuously checks a bounded, read-only external API canary. Browser
  // extraction and real downloads remain in the explicit full live suite.
  testMatch: ["mangadex-api-contract.spec.ts"],
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  reporter: [["line"]],
})
