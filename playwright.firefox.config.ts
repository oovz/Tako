import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "tests/firefox",
  outputDir: "test-results/firefox",
  workers: 1,
  timeout: 90_000,
})
