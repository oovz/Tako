import { describe, expect, it, vi } from "vitest"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { DownloadTaskCard } from "@/entrypoints/options/components/DownloadTaskCard"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { DownloadTaskState } from "@/src/domain/queue/state"

describe("DownloadTaskCard error presentation", () => {
  it("keeps the uncertain-handoff warning visible when another chapter failed later", () => {
    const task: DownloadTaskState = {
      id: "uncertain-task",
      siteIntegrationId: "mangadex",
      mangaId: "series-1",
      seriesTitle: "Series",
      status: "failed",
      errorCategory: "network_unavailable",
      created: 1,
      completed: 2,
      chapters: [
        {
          requestedPath: "Tako/Chapter.cbz",
          id: "chapter-1",
          url: "https://example.com/chapter-1",
          title: "Chapter 1",
          index: 0,
          status: "failed",
          errorCategory: "archive_creation_failed",
          nativeOutputSettlement: {
            jobId: "job-1",
            attempt: 1,
            taskId: "uncertain-task",
            chapterId: "chapter-1",
            requested: 1,
            completed: 0,
            interrupted: 1,
            outputUncertain: true,
            appliedAt: 2,
          },
          lastUpdated: 2,
        },
        {
          requestedPath: "Tako/Chapter.cbz",
          id: "chapter-2",
          url: "https://example.com/chapter-2",
          title: "Chapter 2",
          index: 1,
          status: "failed",
          errorCategory: "network_unavailable",
          lastUpdated: 2,
        },
      ],
      settingsSnapshot: createTaskSettingsSnapshot(
        DEFAULT_SETTINGS,
        "mangadex"
      ),
    }
    const html = renderToStaticMarkup(
      React.createElement(DownloadTaskCard, {
        task,
        onCancel: vi.fn(async () => ({ success: true as const })),
        onRetry: vi.fn(async () => undefined),
        onRestart: vi.fn(async () => undefined),
        onRemove: vi.fn(async () => undefined),
      })
    )
    expect(html).toContain(
      "Chrome file saving could not be confirmed. Retrying may create duplicate files."
    )
    expect(html).toContain("Retry all chapters (may create duplicates)")
    expect(html).toContain("Tako could not create the archive.")
    expect(html).not.toContain("The network connection is unavailable.")
  })

  it.each([
    ["downloads-api", undefined, "Previously processed"],
    ["fsa", undefined, "Previously processed"],
    ["downloads-api", 2, "Saved"],
    ["fsa", 2, "Saved to folder"],
    [undefined, undefined, "Previously processed"],
  ] as const)(
    "renders completed task and chapter results for %s",
    (outputDestination, saveConfirmedAt, label) => {
      const task: DownloadTaskState = {
        id: "completed-task",
        siteIntegrationId: "mangadex",
        mangaId: "series-1",
        seriesTitle: "Series 1",
        status: "completed",
        created: 1,
        completed: 2,
        chapters: [
          {
            requestedPath: "Tako/Chapter.cbz",
            id: "chapter-1",
            url: "https://example.com/chapter-1",
            title: "Chapter 1",
            index: 1,
            status: "completed",
            outputDestination,
            saveConfirmedAt,
            lastUpdated: 2,
          },
        ],
        settingsSnapshot: createTaskSettingsSnapshot(
          DEFAULT_SETTINGS,
          "mangadex"
        ),
      }
      const html = renderToStaticMarkup(
        React.createElement(DownloadTaskCard, {
          task,
          isChapterListExpanded: true,
          onCancel: vi.fn(async () => ({ success: true as const })),
          onRetry: vi.fn(async () => undefined),
          onRestart: vi.fn(async () => undefined),
          onRemove: vi.fn(async () => undefined),
        })
      )
      expect(html.match(new RegExp(`>${label}<`, "g"))).toHaveLength(2)
      expect(html.includes("Final saving was not confirmed.")).toBe(
        saveConfirmedAt === undefined
      )
    }
  )

  it("renders localized categories without exposing task or chapter diagnostics", () => {
    const task: DownloadTaskState = {
      id: "task-1",
      siteIntegrationId: "mangadex",
      mangaId: "series-1",
      seriesTitle: "Series 1",
      status: "failed",
      errorMessage: "ERR_FILE_ACCESS_DENIED task-secret",
      errorCategory: "folder_unavailable",
      created: 1,
      completed: 2,
      chapters: [
        {
          requestedPath: "Tako/Chapter.cbz",
          id: "chapter-1",
          url: "https://example.com/chapter-1",
          title: "Chapter 1",
          index: 1,
          status: "failed",
          errorMessage: "https://signed.example/image?token=chapter-secret",
          errorCategory: "browser_download_interrupted",
          lastUpdated: 2,
        },
      ],
      settingsSnapshot: createTaskSettingsSnapshot(
        DEFAULT_SETTINGS,
        "mangadex"
      ),
    }

    const html = renderToStaticMarkup(
      React.createElement(DownloadTaskCard, {
        task,
        onCancel: vi.fn(async () => ({ success: true as const })),
        onRetry: vi.fn(async () => undefined),
        onRestart: vi.fn(async () => undefined),
        onRemove: vi.fn(async () => undefined),
      })
    )

    expect(html).toContain("Chrome could not finish saving the output.")
    expect(html).not.toContain("The selected folder is no longer available.")
    expect(html).not.toContain("ERR_FILE_ACCESS_DENIED")
    expect(html).not.toContain("task-secret")
    expect(html).not.toContain("chapter-secret")
    expect(html).not.toContain("token=")
  })
})
