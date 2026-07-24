import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"

import { clearE2eCoverageRunOutput } from "@/tests/e2e/coverage-run-output"

describe("E2E coverage run output cleanup", () => {
  it("removes stale output only for coverage-enabled runs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tako-e2e-coverage-"))
    const outputDir = path.join(root, "e2e")
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(outputDir, { recursive: true })
    )
    const sentinel = path.join(outputDir, "stale.json")
    await writeFile(sentinel, "{}", "utf8")

    await clearE2eCoverageRunOutput({ enabled: false, outputDir })
    await expect(readFile(sentinel, "utf8")).resolves.toBe("{}")

    await clearE2eCoverageRunOutput({ enabled: true, outputDir })
    await expect(readFile(sentinel, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    })
  })
})
