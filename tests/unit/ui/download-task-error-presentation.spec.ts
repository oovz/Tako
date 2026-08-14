import { describe, expect, it, vi } from "vitest"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { DownloadTaskCard } from "@/entrypoints/options/components/DownloadTaskCard"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { DownloadTaskState } from "@/src/domain/queue/state"

describe("DownloadTaskCard error presentation", () => {
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

    expect(html).toContain("The selected folder is no longer available.")
    expect(html).not.toContain("ERR_FILE_ACCESS_DENIED")
    expect(html).not.toContain("task-secret")
    expect(html).not.toContain("chapter-secret")
    expect(html).not.toContain("token=")
  })
})
