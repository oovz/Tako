import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execute = promisify(execFile)
const repositoryRoot = process.cwd()
const outputRoot = path.resolve(repositoryRoot, ".output")

type TracePolicyReport = {
  suites: Array<{
    specs: Array<{
      tests: Array<{
        results: Array<{
          status: string
          retry: number
          error?: { message: string }
          attachments: Array<{ name: string; path?: string }>
        }>
      }>
    }>
  }>
}

describe("deterministic E2E trace retention", () => {
  it("retains a trace for an initial failure with retries disabled", async () => {
    await mkdir(outputRoot, { recursive: true })
    const fixture = await mkdtemp(path.join(outputRoot, "trace-policy-"))
    const config = path.join(fixture, "playwright.config.ts")
    const reportPath = path.join(fixture, "report.json")
    try {
      await writeFile(
        config,
        [
          'import { defineConfig } from "@playwright/test"',
          'import base from "../../playwright.config"',
          "export default defineConfig({",
          "  ...base, globalSetup: undefined, retries: 0, workers: 1,",
          '  testDir: ".", outputDir: "./results", reporter: [["json"]],',
          '  projects: [{ name: "trace-policy" }],',
          "})",
        ].join("\n")
      )
      await writeFile(
        path.join(fixture, "failure.spec.ts"),
        [
          'import { test } from "@playwright/test"',
          'test("controlled trace failure", () => {',
          '  throw new Error("controlled trace-retention failure")',
          "})",
        ].join("\n")
      )

      let exitCode: unknown
      try {
        await execute(
          process.execPath,
          [
            path.join(repositoryRoot, "node_modules/@playwright/test/cli.js"),
            "test",
            "--config",
            config,
          ],
          {
            cwd: repositoryRoot,
            windowsHide: true,
            timeout: 15_000,
            env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
          }
        )
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error)) throw error
        exitCode = error.code
      }
      expect(exitCode).toBe(1)
      const report: TracePolicyReport = JSON.parse(
        await readFile(reportPath, "utf8")
      )
      const results = report.suites
        .flatMap((suite) => suite.specs)
        .flatMap((spec) => spec.tests)
        .flatMap((test) => test.results)
      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({
        status: "failed",
        retry: 0,
        error: {
          message: expect.stringContaining(
            "controlled trace-retention failure"
          ),
        },
      })
      const trace = results[0]!.attachments.find(
        (attachment) => attachment.name === "trace"
      )
      expect(trace?.path).toBeDefined()
      expect((await stat(trace!.path!)).size).toBeGreaterThan(0)
    } finally {
      expect(path.resolve(fixture).startsWith(outputRoot + path.sep)).toBe(true)
      await rm(fixture, { recursive: true, force: true })
    }
  }, 20_000)
})
