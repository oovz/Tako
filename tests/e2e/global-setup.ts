import type { FullConfig } from "@playwright/test"
import { exec } from "node:child_process"
import { existsSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { clearE2eCoverageRunOutput } from "./coverage-run-output"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default async function globalSetup(_config: FullConfig) {
  const isLiveTest = process.env.TMD_TEST_E2E_LIVE === "true"
  const skipBuild = process.env.TMD_TEST_E2E_SKIP_BUILD === "true"
  const buildDir = path.resolve(
    __dirname,
    isLiveTest
      ? "../../.output/chrome-mv3-live-test"
      : "../../.output/chrome-mv3-e2e-test"
  )
  const buildCommand = isLiveTest
    ? "pnpm generate:site-integrations && pnpm exec wxt build --mode live-test"
    : "pnpm generate:site-integrations && pnpm exec wxt build --mode e2e-test"
  await clearE2eCoverageRunOutput({
    enabled: process.env.E2E_COVERAGE === "true",
    outputDir: path.resolve(__dirname, "../../.nyc_output/e2e"),
  })

  if (!skipBuild) {
    rmSync(buildDir, { recursive: true, force: true })

    await new Promise<void>((resolve, reject) => {
      exec(
        buildCommand,
        {
          cwd: path.resolve(__dirname, "../../"),
          windowsHide: true,
          env: {
            ...process.env,
            E2E_COVERAGE: process.env.E2E_COVERAGE ?? "false",
            // Queue seeding is restricted to isolated test builds.
            TAKO_E2E_STATE_SEED:
              process.env.TMD_TEST_E2E_USE_MOCKS === "true" ? "true" : "false",
          },
        },
        (error, stdout, stderr) => {
          process.stdout.write(stdout || "")
          process.stderr.write(stderr || "")
          if (error) reject(new Error(`wxt build failed: ${error.message}`))
          else resolve()
        }
      )
    })
  }

  if (!existsSync(buildDir)) {
    throw new Error(`Build output not found at ${buildDir}`)
  }
}
