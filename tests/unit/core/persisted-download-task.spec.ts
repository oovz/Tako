import { describe, expect, it } from "vitest"

import { normalizePersistedDownloadTask } from "@/src/runtime/persisted-download-task"

function createRawTask(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: "task-1",
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Series 1",
    status: "queued",
    created: 123,
    chapters: [
      {
        id: "ch-1",
        url: "https://example.com/ch-1",
        title: "Chapter 1",
        index: 1,
        status: "queued",
        lastUpdated: 456,
      },
    ],
    ...overrides,
  }
}

describe("normalizePersistedDownloadTask", () => {
  it("rejects a task whose persisted settings snapshot is malformed", () => {
    const task = normalizePersistedDownloadTask(
      createRawTask({
        settingsSnapshot: {
          archiveFormat: "rar",
          overwriteExisting: "yes",
          pathTemplate: "",
          fileNameTemplate: "",
          includeComicInfo: "true",
          includeCoverImage: 1,
        },
      })
    )

    expect(task).toBeNull()
  })

  it("preserves valid persisted scalar snapshot fields", () => {
    const task = normalizePersistedDownloadTask(
      createRawTask({
        settingsSnapshot: {
          archiveFormat: "none",
          fsaCollisionPolicy: "skip",
          overwriteExisting: true,
          pathTemplate: "Library/<SERIES_TITLE>",
          fileNameTemplate: "<SERIES_TITLE> - <CHAPTER_TITLE>",
          includeComicInfo: false,
          includeCoverImage: false,
        },
      })
    )

    expect(task).not.toBeNull()
    expect(task?.settingsSnapshot.archiveFormat).toBe("none")
    expect(task?.settingsSnapshot.destination).toBe("downloads-api")
    expect(task?.settingsSnapshot.conflictPolicy).toBe("overwrite")
    expect(task?.settingsSnapshot.pathTemplate).toBe("Library/<SERIES_TITLE>")
    expect(task?.settingsSnapshot.fileNameTemplate).toBe(
      "<SERIES_TITLE> - <CHAPTER_TITLE>"
    )
    expect(task?.settingsSnapshot.includeComicInfo).toBe(false)
    expect(task?.settingsSnapshot.includeCoverImage).toBe(false)
  })

  it("preserves committed Chrome download ids across active-task recovery", () => {
    const queuedTask = normalizePersistedDownloadTask(
      createRawTask({
        status: "queued",
        lastSuccessfulDownloadId: 123,
      })
    )
    const downloadingTask = normalizePersistedDownloadTask(
      createRawTask({
        status: "downloading",
        lastSuccessfulDownloadId: 456,
      })
    )
    const completedTask = normalizePersistedDownloadTask(
      createRawTask({
        status: "completed",
        lastSuccessfulDownloadId: 789,
      })
    )

    expect(queuedTask?.lastSuccessfulDownloadId).toBe(123)
    expect(downloadingTask?.lastSuccessfulDownloadId).toBe(456)
    expect(completedTask?.lastSuccessfulDownloadId).toBe(789)
  })

  it("normalizes structured task and chapter error categories", () => {
    const task = normalizePersistedDownloadTask(
      createRawTask({
        status: "failed",
        errorMessage: "raw task diagnostic",
        errorCategory: "provider_changed",
        chapters: [
          {
            id: "ch-1",
            url: "https://example.com/ch-1",
            title: "Chapter 1",
            index: 1,
            status: "failed",
            errorMessage: "ERR_FILE_ACCESS_DENIED",
            errorCategory: "folder_permission_required",
            lastUpdated: 456,
          },
        ],
      })
    )

    expect(task?.errorCategory).toBe("provider_changed")
    expect(task?.chapters[0]?.errorCategory).toBe("folder_permission_required")
  })

  it.each([
    { id: undefined },
    { status: "unknown" },
    { created: undefined },
    {
      chapters: [
        {
          id: "",
          url: "https://example.com/ch-1",
          title: "Chapter 1",
          index: 1,
          status: "queued",
          lastUpdated: 456,
        },
      ],
    },
    {
      chapters: [
        {
          id: "ch-1",
          url: "https://example.com/ch-1",
          title: "Chapter 1",
          index: 1,
          status: "unknown",
          lastUpdated: 456,
        },
      ],
    },
  ])(
    "rejects corrupted task identity and lifecycle fields: %o",
    (overrides) => {
      expect(
        normalizePersistedDownloadTask(createRawTask(overrides))
      ).toBeNull()
    }
  )
})
