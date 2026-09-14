import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import {
  assertTaskSucceeded,
  createDiagnosticEventRecorder,
} from "@/tests/live/fixtures/download-workflow-helpers"

describe("live diagnostic artifact boundary", () => {
  it("saves redacted recorder and failed-task messages with useful context", async () => {
    const marker = "SYNTHETIC_SAVED_DIAGNOSTIC_SECRET"
    const url = `https://provider.example/image.png?token=${marker}#${marker}`
    const { diagnosticEvents, recordDiagnostic } =
      createDiagnosticEventRecorder()
    recordDiagnostic({
      event: "request-failed",
      url,
      headers: { Authorization: marker },
    })
    let failure: Error | undefined
    try {
      assertTaskSucceeded({
        id: "diagnostic-task",
        siteIntegrationId: "mangadex",
        mangaId: "series-1",
        seriesTitle: "Series",
        status: "failed",
        created: 1,
        chapters: [],
        errorCategory: "network_unavailable",
        errorMessage: `Image request failed: ${url}`,
        settingsSnapshot: createTaskSettingsSnapshot(
          DEFAULT_SETTINGS,
          "mangadex"
        ),
      })
    } catch (error) {
      if (!(error instanceof Error)) throw error
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    const directory = await mkdtemp(join(tmpdir(), "tako-diagnostic-"))
    const artifact = join(directory, "failure-diagnostics.txt")
    try {
      await writeFile(
        artifact,
        JSON.stringify({ diagnosticEvents, failure: failure?.message }),
        "utf8"
      )
      const saved = await readFile(artifact, "utf8")
      expect(saved).not.toContain(marker)
      expect(saved).toContain("https://provider.example/image.png")
      expect(saved).toContain("diagnostic-task")
      expect(saved).toContain("request-failed")
      expect(saved).toContain("network_unavailable")
    } finally {
      await unlink(artifact)
      await rmdir(directory)
    }
  })

  it("keeps automatic network tracing off in both live configurations", async () => {
    const keys = [
      "TMD_TEST_E2E_USE_MOCKS",
      "TMD_TEST_E2E_ALLOW_NETWORK",
      "TMD_TEST_E2E_LIVE",
    ] as const
    const original = keys.map((key) => process.env[key])
    try {
      const { default: full } = await import("../../../playwright.live.config")
      const { default: canary } =
        await import("../../../playwright.live.ci.config")
      expect(full.use?.trace).toBe("off")
      expect(canary.use?.trace).toBe("off")
    } finally {
      keys.forEach((key, index) => {
        if (original[index] === undefined) delete process.env[key]
        else process.env[key] = original[index]
      })
    }
  })
})
