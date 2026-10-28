import { defineConfig, devices } from "@playwright/test"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.TMD_TEST_E2E_USE_MOCKS = "false"
process.env.TMD_TEST_E2E_ALLOW_NETWORK = "true"
process.env.TMD_TEST_E2E_LIVE = "true"

export default defineConfig({
  testDir: path.resolve(__dirname, "tests/live"),
  fullyParallel: false, // Limit concurrent requests to each provider.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 3 : 0,
  workers: process.env.CI ? 3 : 6,
  reporter: [["list"]],
  // Allow the 150-second download timeout to finish and collect diagnostics.
  timeout: 240_000,
  expect: { timeout: 10_000 },
  use: {
    locale: "en-US",
    // CI supplies Xvfb for extension contexts.
    headless: false,
    // Live traces can retain unredacted request URLs and headers.
    trace: "off",
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
  globalSetup: path.resolve(__dirname, "tests/e2e/global-setup.ts"),
  projects: [
    {
      name: "harness",
      testDir: path.resolve(__dirname, "tests/live/harness"),
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium-tip-of-tree",
      },
    },
    {
      name: "mangadex",
      testDir: path.resolve(__dirname, "tests/live/mangadex"),
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium-tip-of-tree",
      },
    },
    {
      name: "pixiv-comic",
      testDir: path.resolve(__dirname, "tests/live/pixiv-comic"),
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium-tip-of-tree",
      },
    },
    {
      name: "shonenjumpplus",
      testDir: path.resolve(__dirname, "tests/live/shonenjumpplus"),
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium-tip-of-tree",
      },
    },
    {
      name: "readmanga",
      testDir: path.resolve(__dirname, "tests/live/readmanga"),
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium-tip-of-tree",
      },
    },
    {
      name: "comictropics",
      testDir: path.resolve(__dirname, "tests/live/comictropics"),
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium-tip-of-tree",
      },
    },
    {
      name: "mangamillion",
      testDir: path.resolve(__dirname, "tests/live/mangamillion"),
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium-tip-of-tree",
      },
    },
    ...[
      "boylove",
      "mangago",
      "manganato",
      "mangakakalot",
      "coolmic",
      "mangaplus",
      "animemangahouse",
      "mangaagain",
      "copymanga",
      "mycomic",
      "mangabz",
      "mangahere",
      "lovemanga",
    ].map((name) => ({
      name,
      testDir: path.resolve(__dirname, `tests/live/${name}`),
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium-tip-of-tree",
      },
    })),
  ],
})
