import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execute = promisify(execFile)
const repositoryRoot = process.cwd()
const outputRoot = path.resolve(repositoryRoot, ".output")
const script = path.join(
  repositoryRoot,
  "scripts/check-architecture-boundaries.mjs"
)

describe("durable storage mutation architecture boundary", () => {
  it.each([
    ["src/runtime/feature.ts", false],
    ["src/storage/feature-repository.ts", true],
    ["src/runtime/state-schema-migration.ts", true],
    ["entrypoints/background/index.ts", true],
    ["entrypoints/background/e2e-state-seed.ts", true],
  ] as const)("checks the mutation owner for %s", async (file, allowed) => {
    await mkdir(outputRoot, { recursive: true })
    const fixture = await mkdtemp(
      path.join(outputRoot, "architecture-storage-")
    )
    try {
      const target = path.join(fixture, file)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(
        target,
        "chrome.storage.local.set({ key: 1 });\nchrome.storage.local.remove('key');\nchrome.storage.local.clear();\n"
      )
      const check = execute(process.execPath, [script], {
        cwd: fixture,
        windowsHide: true,
      })
      if (allowed) {
        await expect(check).resolves.toMatchObject({
          stdout: expect.stringContaining("Architecture boundaries OK"),
        })
      } else {
        await expect(check).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "Durable local storage mutations belong in src/storage/"
          ),
        })
      }
    } finally {
      expect(path.resolve(fixture).startsWith(outputRoot + path.sep)).toBe(true)
      await rm(fixture, { recursive: true, force: true })
    }
  })
})
