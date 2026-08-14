import { describe, expect, it } from "vitest"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { DownloadTaskState } from "@/src/domain/queue/state"

import { assertTaskSucceeded } from "@/tests/e2e/fixtures/download-workflow-helpers"

function makeTask(
  overrides: Partial<DownloadTaskState> = {}
): DownloadTaskState {
  return {
    id: "task-1",
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Series",
    status: "completed",
    created: 1,
    chapters: [
      {
        id: "chapter-1",
        url: "https://example.test/chapter-1",
        title: "Chapter 1",
        index: 1,
        status: "completed",
        imagesFailed: 0,
        outputs: { requested: 1, committed: 1, failed: 0 },
        lastUpdated: 1,
      },
    ],
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
    ...overrides,
  }
}

describe("download workflow terminal assertions", () => {
  it("accepts only fully completed output", () => {
    expect(() => assertTaskSucceeded(makeTask())).not.toThrow()
  })

  it("rejects partial task, chapter, image, and destination outcomes", () => {
    expect(() =>
      assertTaskSucceeded(makeTask({ status: "partial_success" }))
    ).toThrow(/partial_success/)
    expect(() =>
      assertTaskSucceeded(
        makeTask({
          chapters: [
            {
              ...makeTask().chapters[0]!,
              status: "partial_success",
            },
          ],
        })
      )
    ).toThrow(/completed/)
    expect(() =>
      assertTaskSucceeded(
        makeTask({
          chapters: [
            {
              ...makeTask().chapters[0]!,
              imagesFailed: 1,
            },
          ],
        })
      )
    ).toThrow(/completed/)
    expect(() =>
      assertTaskSucceeded(
        makeTask({
          chapters: [
            {
              ...makeTask().chapters[0]!,
              outputs: { requested: 1, committed: 0, failed: 1 },
            },
          ],
        })
      )
    ).toThrow(/completed/)
  })
})
