import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import type { DownloadTaskActionResult } from "@/entrypoints/options/types/download-task-actions"
import { DownloadTaskCard } from "@/entrypoints/options/components/DownloadTaskCard"
import { t } from "@/src/runtime/i18n"
import { formatBytes } from "@/entrypoints/options/components/downloads-tab-helpers"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import type { DownloadTaskState, TaskChapter } from "@/src/domain/queue/state"

it("renders chapter progress and errors for each supported result state", () => {
  const statuses: TaskChapter["status"][] = [
    "queued",
    "downloading",
    "partial_success",
    "failed",
    "canceled",
    "skipped",
  ]
  const task: DownloadTaskState = {
    id: "task",
    status: "partial_success",
    seriesTitle: "Series",
    siteIntegrationId: "mangadex",
    mangaId: "series",
    created: 1,
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
    chapters: statuses.map((status, index) => ({
      id: status,
      status,
      index,
      title: `Chapter ${index + 1}`,
      url: `https://example.com/${status}`,
      requestedPath: `Chapter ${index + 1}.cbz`,
      totalImages: index === 0 ? 0 : 3,
      imagesFailed: status === "partial_success" ? 1 : undefined,
      errorCategory: status === "failed" ? "network_unavailable" : undefined,
      lastUpdated: 1,
    })),
  }
  const html = renderToStaticMarkup(
    createElement(DownloadTaskCard, {
      task,
      isChapterListExpanded: true,
      onCancel: async (): Promise<DownloadTaskActionResult> => ({
        success: true,
      }),
      onRetry: async () => undefined,
      onRestart: async () => undefined,
      onRemove: async () => undefined,
    })
  )
  expect(html).toContain(">Queued<")
  expect(html).toContain(">Downloading<")
  expect(html).toContain(`>${t("status_partialSuccess")}<`)
  expect(html).toContain(">Failed<")
  expect(html).toContain(">canceled<")
  expect(html).toContain(">Skipped<")
  expect(html).toContain(t("options_imagesFailed", ["2", "3", "1"]))
  expect(html).toContain("The network connection is unavailable.")
})

it.each([
  [0, "0 B"],
  [1023, "1023 B"],
  [1024, "1.0 KB"],
  [1024 ** 2 - 1, "1024.0 KB"],
  [1024 ** 2, "1.0 MB"],
  [1024 ** 3 - 1, "1024.0 MB"],
  [1024 ** 3, "1.0 GB"],
])("formats history storage bytes %i as %s", (bytes, expected) => {
  expect(formatBytes(Number(bytes))).toBe(expected)
})

it.each<{
  status: DownloadTaskState["status"]
  retried: boolean
  targetAvailable: boolean
  recovery: boolean
  removal: boolean
}>([
  {
    status: "partial_success",
    retried: true,
    targetAvailable: true,
    recovery: false,
    removal: false,
  },
  {
    status: "partial_success",
    retried: false,
    targetAvailable: false,
    recovery: false,
    removal: true,
  },
  {
    status: "failed",
    retried: true,
    targetAvailable: true,
    recovery: false,
    removal: true,
  },
  {
    status: "canceled",
    retried: false,
    targetAvailable: true,
    recovery: true,
    removal: true,
  },
])(
  "preserves recovery availability for $status (retried=$retried, targetAvailable=$targetAvailable)",
  ({ status, retried, targetAvailable, recovery, removal }) => {
    const task: DownloadTaskState = {
      id: "task",
      status,
      isRetried: retried,
      seriesTitle: "Series",
      siteIntegrationId: "mangadex",
      mangaId: "series",
      created: 1,
      settingsSnapshot: createTaskSettingsSnapshot(
        DEFAULT_SETTINGS,
        "mangadex"
      ),
      chapters: [
        {
          id: "chapter",
          status: "failed",
          index: 0,
          title: "Chapter",
          url: "https://example.com/chapter",
          requestedPath: targetAvailable ? "Series/chapter.cbz" : null,
          lastUpdated: 1,
        },
      ],
    }
    const html = renderToStaticMarkup(
      createElement(DownloadTaskCard, {
        task,
        onCancel: async (): Promise<DownloadTaskActionResult> => ({
          success: true,
        }),
        onRetry: async () => undefined,
        onRestart: async () => undefined,
        onRemove: async () => undefined,
      })
    )
    expect(html.includes(`>${t("sidepanel_restartTask")}<`)).toBe(recovery)
    expect(html.includes(`>${t("common_remove")}<`)).toBe(removal)
    expect(html).not.toContain(`>${t("sidepanel_retryFailedChapters")}<`)
  }
)
