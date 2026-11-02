import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Window } from "happy-dom"
import { expect, it } from "vitest"
import {
  processNoneFormatChapter,
  type ChapterProcessingRuntime,
} from "@/entrypoints/offscreen/chapter-processing"
import { withRetries } from "@/entrypoints/offscreen/image-processor"
import type { DownloadTaskActionResult } from "@/entrypoints/options/types/download-task-actions"
import { DownloadTaskCard } from "@/entrypoints/options/components/DownloadTaskCard"
import { t } from "@/src/runtime/i18n"
import { formatBytes } from "@/entrypoints/options/components/downloads-tab-helpers"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import type { DownloadTaskState, TaskChapter } from "@/src/domain/queue/state"
import { DownloadTaskStateSchema } from "@/src/runtime/queue-state-schemas"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { SHONEN_JUMP_PLUS_SCRAMBLED_PNG } from "@/tests/e2e/fixtures/mock-data/site-integrations/shonenjumpplus/scrambled-image-fixture"

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

async function captureFolderResult(total: number, failedPages: number[]) {
  const created = Date.now()
  const closedPaths: string[] = []
  const failedUrls: string[] = []
  const urls = Array.from(
    { length: total },
    (_, index) => `https://images.example/page-${index + 1}.png`
  )
  const requestedPath = "Recorded/Volume 7/Chapter 19"
  const ledger = new OffscreenLiveResourceLedger()
  const rateLimitService = new RateLimitService({
    resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
  })
  const directory = (prefix = ""): FileSystemDirectoryHandle =>
    ({
      getDirectoryHandle: async (name: string) =>
        directory(`${prefix}${name}/`),
      getFileHandle: async (name: string) => ({
        createWritable: async () => ({
          write: async () => undefined,
          close: async () => {
            closedPaths.push(`${prefix}${name}`)
          },
          abort: async () => undefined,
        }),
      }),
    }) as unknown as FileSystemDirectoryHandle
  const settings = structuredClone(DEFAULT_SETTINGS)
  Object.assign(settings.downloads, {
    defaultFormat: "none",
    destination: "file-system-access",
    customDirectoryHandleId: "recorded-folder",
    conflictPolicy: "overwrite",
    includeComicInfo: false,
    includeCoverImage: false,
    normalizeImageFilenames: true,
    imagePaddingDigits: 3,
  })
  settings.globalPolicy.image = { concurrency: 1, delayMs: 0 }
  settings.globalPolicy.chapter = { concurrency: 1, delayMs: 0 }
  settings.globalRetries = { image: 0, chapter: 0 }
  const settingsSnapshot = createTaskSettingsSnapshot(settings, "mangadex")
  const runtime: ChapterProcessingRuntime = {
    liveResourceLedger: ledger,
    rateLimitService,
    withImageRetries: (operation, hooks, signal) =>
      withRetries(operation, 0, 0, hooks, signal),
    beginFsaWrite: async () => undefined,
    resolveWritableDownloadRoot: async () => directory(),
    requestBrowserBlobDownload: async () => {
      throw new Error("Folder output cannot use browser handoff")
    },
    getMemoryStats: () => null,
  }
  let observedTotal: number | undefined
  try {
    const outcome = await processNoneFormatChapter(runtime, {
      opts: {
        taskId: "recorded-task",
        jobId: "recorded-job",
        attempt: 1,
        chapter: {
          id: "recorded-chapter",
          title: "Only chapter",
          url: "https://mangadex.org/chapter/11111111-1111-4111-8111-111111111111",
          resolvedPath: requestedPath,
          comicInfo: {},
        },
        seriesTitle: "Recorded series",
        format: "none",
        downloadMode: "custom",
        directoryHandleId: "recorded-folder",
        includeComicInfo: false,
        comicInfoVersion: "2.0",
        abortSignal: new AbortController().signal,
        onProgress: async (_value, _label, progress) => {
          if (progress) observedTotal = progress.total
        },
        onArchiveProgress: async () => undefined,
        settingsSnapshot,
      },
      urls,
      integrationId: "mangadex",
      downloadImage: async (url) => {
        if (failedPages.includes(urls.indexOf(url))) {
          failedUrls.push(url)
          throw new Error("Page transport unavailable")
        }
        const bytes = new Uint8Array(SHONEN_JUMP_PLUS_SCRAMBLED_PNG)
        return {
          data: bytes.buffer,
          filename: "page.png",
          mimeType: "image/png",
          liveResourceLease: ledger.reserve(bytes.byteLength, "page response"),
        }
      },
      normalizeSettings: {
        normalizeImageFilenames: true,
        imagePaddingDigits: 3,
      },
    })
    expect(ledger.getUsedBytes()).toBe(0)
    expect(outcome.outputsCommitted).toBe(closedPaths.length)
    expect(
      closedPaths.every((path) => path.startsWith(`${requestedPath}/`))
    ).toBe(true)
    const completed = Date.now()
    const task: DownloadTaskState = DownloadTaskStateSchema.parse({
      id: "recorded-task",
      siteIntegrationId: "mangadex",
      mangaId: "recorded-series",
      seriesTitle: "Recorded series",
      status: outcome.status,
      created,
      started: created,
      completed,
      settingsSnapshot,
      chapters: [
        {
          id: "recorded-chapter",
          title: "Only chapter",
          url: "https://mangadex.org/chapter/11111111-1111-4111-8111-111111111111",
          index: 0,
          status: outcome.status,
          requestedPath,
          totalImages: observedTotal,
          imagesFailed: outcome.imagesFailed,
          errorMessage: outcome.errorMessage,
          errorCategory: outcome.errorCategory,
          outputs: {
            requested: outcome.outputsRequested,
            committed: closedPaths.length,
            failed: failedUrls.length,
          },
          outputDestination: "fsa",
          saveConfirmedAt:
            outcome.status === "completed" ? completed : undefined,
          lastUpdated: completed,
        },
      ],
    })
    return { task, closedPaths, failedUrls, urls }
  } finally {
    rateLimitService.cleanupRateLimiters()
  }
}

function resultDocument(task: DownloadTaskState) {
  const document = new Window().document
  document.body.innerHTML = renderToStaticMarkup(
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
  return document
}

it.each([
  { total: 3, failedPages: [], expectedCounts: [3, 3] },
  { total: 3, failedPages: [1], expectedCounts: [2, 3, 1] },
  { total: 3, failedPages: [0, 1, 2], expectedCounts: [0, 3] },
  { total: 1, failedPages: [], expectedCounts: [1, 1] },
])(
  "shows captured image results for $total pages with failures $failedPages",
  async ({ total, failedPages, expectedCounts }) => {
    const captured = await captureFolderResult(total, failedPages)
    const document = resultDocument(captured.task)
    const row = document.querySelector('[role="rowgroup"] [role="row"]')!
    const imageCell = row.querySelectorAll('[role="cell"]')[2]
    const counts = imageCell.textContent.match(/\d+/g)?.map(Number)
    expect(counts).toEqual(expectedCounts)
    if (captured.task.status === "completed") {
      expect(
        document.querySelector("[data-task-destination]")?.textContent
      ).toContain(captured.task.chapters[0].requestedPath)
    }
  }
)

it("keeps an unresolved queued chapter's image count unknown", () => {
  const task = DownloadTaskStateSchema.parse({
    id: "queued-task",
    siteIntegrationId: "mangadex",
    mangaId: "series",
    seriesTitle: "Unresolved series",
    status: "queued",
    created: 1,
    settingsSnapshot: createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
    chapters: [
      {
        id: "queued-chapter",
        title: "Unresolved chapter",
        url: "https://mangadex.org/chapter/22222222-2222-4222-8222-222222222222",
        index: 0,
        status: "queued",
        requestedPath: "Recorded/queued.cbz",
        lastUpdated: 1,
      },
    ],
  })
  const row = resultDocument(task).querySelector(
    '[role="rowgroup"] [role="row"]'
  )!
  expect(row.querySelectorAll('[role="cell"]')[2].textContent).not.toMatch(/\d/)
})
