// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { DownloadTaskActionResult } from "@/entrypoints/options/types/download-task-actions"
import { DownloadTaskCard } from "@/entrypoints/options/components/DownloadTaskCard"
import type { DownloadTaskState, TaskChapter } from "@/src/domain/queue/state"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { t } from "@/src/runtime/i18n"
import { DownloadTaskStateSchema } from "@/src/runtime/queue-state-schemas"
import {
  processNoneFormatChapter,
  type ChapterProcessingRuntime,
} from "@/entrypoints/offscreen/chapter-processing"
import { withRetries } from "@/entrypoints/offscreen/image-processor"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { RateLimitService } from "@/src/runtime/rate-limit"
import { SHONEN_JUMP_PLUS_SCRAMBLED_PNG } from "@/tests/e2e/fixtures/mock-data/site-integrations/shonenjumpplus/scrambled-image-fixture"

const boundary = vi.hoisted(() => ({
  load: vi.fn(),
  permission: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock("@/src/storage/fs-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/storage/fs-access")>()),
  loadDownloadRootHandle: boundary.load,
  verifyPermission: boundary.permission,
  saveDownloadRootHandle: vi.fn(),
}))
vi.mock("sonner", () => ({
  toast: { success: boundary.success, error: boundary.error },
}))
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.clearAllMocks()
  boundary.load.mockResolvedValue({ name: "Captured folder" })
  boundary.permission.mockResolvedValue(true)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

function folderTask(
  errorCategory: TaskChapter["errorCategory"] = "folder_permission_required"
): DownloadTaskState {
  return DownloadTaskStateSchema.parse({
    id: "captured-task",
    siteIntegrationId: "mangadex",
    mangaId: "series",
    seriesTitle: "Series",
    status: "failed",
    created: 1,
    settingsSnapshot: {
      ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mangadex"),
      destination: { kind: "file-system-access", handleId: "captured-folder" },
    },
    chapters: [
      {
        id: "chapter",
        title: "Chapter",
        index: 0,
        url: "https://example.com/chapter",
        requestedPath: "Captured/Chapter.cbz",
        status: "failed",
        lastUpdated: 1,
        errorCategory,
      },
    ],
  })
}

async function partialFolderTask(): Promise<DownloadTaskState> {
  const now = Date.now()
  const closedPaths: string[] = []
  let writableCount = 0
  const directory = (prefix = ""): FileSystemDirectoryHandle =>
    ({
      getDirectoryHandle: async (name: string) =>
        directory(`${prefix}${name}/`),
      removeEntry: async () => undefined,
      getFileHandle: async (name: string) => ({
        createWritable: async () => {
          if (++writableCount === 2)
            throw new DOMException(
              "Write permission was revoked",
              "NotAllowedError"
            )
          return {
            write: async () => undefined,
            close: async () => {
              closedPaths.push(`${prefix}${name}`)
            },
            abort: async () => undefined,
          }
        },
      }),
    }) as unknown as FileSystemDirectoryHandle
  const settings = structuredClone(DEFAULT_SETTINGS)
  Object.assign(settings.downloads, {
    defaultFormat: "none",
    destination: "file-system-access",
    customDirectoryHandleId: "captured-folder",
    includeComicInfo: false,
    includeCoverImage: false,
    conflictPolicy: "overwrite",
    normalizeImageFilenames: true,
    imagePaddingDigits: 3,
  })
  settings.globalPolicy.image = { concurrency: 1, delayMs: 0 }
  settings.globalPolicy.chapter = { concurrency: 1, delayMs: 0 }
  settings.globalRetries = { image: 0, chapter: 0 }
  const settingsSnapshot = createTaskSettingsSnapshot(settings, "mangadex")
  const ledger = new OffscreenLiveResourceLedger()
  const rateLimitService = new RateLimitService({
    resolveEffectivePolicy: async () => ({ concurrency: 1, delayMs: 0 }),
  })
  const runtime: ChapterProcessingRuntime = {
    liveResourceLedger: ledger,
    rateLimitService,
    withImageRetries: (operation, hooks, signal) =>
      withRetries(operation, 0, 0, hooks, signal),
    beginFsaWrite: async () => undefined,
    resolveWritableDownloadRoot: async () => directory(),
    requestBrowserBlobDownload: async () => {
      throw new Error("Unexpected browser handoff")
    },
    getMemoryStats: () => null,
  }
  try {
    const outcome = await processNoneFormatChapter(runtime, {
      opts: {
        taskId: "partial-folder-task",
        jobId: "partial-folder-job",
        attempt: 1,
        chapter: {
          id: "chapter",
          title: "Chapter",
          url: "https://mangadex.org/chapter/11111111-1111-4111-8111-111111111111",
          resolvedPath: "Captured/Chapter",
          comicInfo: {},
        },
        seriesTitle: "Partly saved series",
        format: "none",
        downloadMode: "custom",
        directoryHandleId: "captured-folder",
        includeComicInfo: false,
        comicInfoVersion: "2.0",
        abortSignal: new AbortController().signal,
        onProgress: async () => undefined,
        onArchiveProgress: async () => undefined,
        settingsSnapshot,
      },
      urls: [1, 2, 3].map((page) => `https://images.example/${page}.png`),
      integrationId: "mangadex",
      downloadImage: async () => {
        const bytes = new Uint8Array(SHONEN_JUMP_PLUS_SCRAMBLED_PNG)
        return {
          data: bytes.buffer,
          mimeType: "image/png",
          filename: "page.png",
          liveResourceLease: ledger.reserve(bytes.byteLength, "page response"),
        }
      },
      normalizeSettings: {
        normalizeImageFilenames: true,
        imagePaddingDigits: 3,
      },
    })
    expect(outcome.status).toBe("partial_success")
    expect(outcome.errorCategory).toBe("folder_permission_required")
    expect(closedPaths).toHaveLength(1)
    expect(outcome.outputsCommitted).toBe(closedPaths.length)
    expect(ledger.getUsedBytes()).toBe(0)
    return DownloadTaskStateSchema.parse({
      id: "partial-folder-task",
      siteIntegrationId: "mangadex",
      mangaId: "series",
      seriesTitle: "Partly saved series",
      status: outcome.status,
      errorCategory: outcome.errorCategory,
      errorMessage: outcome.errorMessage,
      created: now,
      started: now,
      completed: Date.now(),
      settingsSnapshot,
      chapters: [
        {
          id: "chapter",
          title: "Chapter",
          index: 0,
          url: "https://mangadex.org/chapter/11111111-1111-4111-8111-111111111111",
          requestedPath: "Captured/Chapter",
          status: outcome.status,
          errorCategory: outcome.errorCategory,
          errorMessage: outcome.errorMessage,
          totalImages: 3,
          imagesFailed: outcome.imagesFailed,
          outputs: {
            requested: outcome.outputsRequested,
            committed: outcome.outputsCommitted,
            failed: outcome.outputsRequested - outcome.outputsCommitted,
          },
          outputDestination: "fsa",
          lastUpdated: Date.now(),
        },
      ],
    })
  } finally {
    rateLimitService.cleanupRateLimiters()
  }
}

it.each(["granted", "missing", "denied", "rejected"])(
  "reports %s folder access without submitting a new task",
  async (outcome) => {
    if (outcome === "missing") boundary.load.mockResolvedValue(null)
    if (outcome === "denied") boundary.permission.mockResolvedValue(false)
    if (outcome === "rejected")
      boundary.permission.mockRejectedValue(new Error("Permission unavailable"))
    const task = folderTask()
    const restart = vi.fn(async () => undefined)
    await act(async () =>
      root.render(
        createElement(DownloadTaskCard, {
          task,
          onCancel: async (): Promise<DownloadTaskActionResult> => ({
            success: true,
          }),
          onRetry: restart,
          onRestart: restart,
          onRemove: async () => undefined,
        })
      )
    )
    const grant = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === t("folderAccess_grant")
    )!
    expect(grant).toBeDefined()
    const initialLoads = boundary.load.mock.calls.length
    act(() => grant.click())
    expect(boundary.load).toHaveBeenCalledTimes(initialLoads + 1)
    expect(boundary.load).toHaveBeenLastCalledWith("captured-folder")
    await act(async () => {})
    if (outcome === "granted")
      expect(boundary.success).toHaveBeenCalledExactlyOnceWith(
        t("taskFolder_accessGranted")
      )
    else if (outcome === "rejected")
      expect(boundary.error).toHaveBeenCalledExactlyOnceWith(
        t("taskFolder_accessFailed"),
        { description: "Permission unavailable" }
      )
    else
      expect(boundary.error).toHaveBeenCalledExactlyOnceWith(
        t(
          outcome === "missing"
            ? "settings_customFolderNotFound"
            : "options_toastPermissionDenied"
        )
      )
    expect(restart).not.toHaveBeenCalled()
    expect(task.status).toBe("failed")
    expect(grant.disabled).toBe(false)
  }
)

it("does not request folder permission for a reader-network failure", async () => {
  const task = folderTask("network_unavailable")
  await act(async () =>
    root.render(
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
  )
  expect(container.textContent).toContain(task.seriesTitle)
  expect(
    [...container.querySelectorAll("button")].find(
      (button) => button.textContent === t("folderAccess_grant")
    )
  ).toBeUndefined()
  expect(boundary.permission).not.toHaveBeenCalled()
})

it("keeps partial folder recovery busy until writable permission is confirmed", async () => {
  const task = await partialFolderTask()
  const permission = Promise.withResolvers<boolean>()
  boundary.permission.mockReturnValueOnce(permission.promise)
  const restart = vi.fn(async () => undefined)
  await act(async () =>
    root.render(
      createElement(DownloadTaskCard, {
        task,
        onCancel: async (): Promise<DownloadTaskActionResult> => ({
          success: true,
        }),
        onRetry: restart,
        onRestart: restart,
        onRemove: async () => undefined,
      })
    )
  )
  const grant = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === t("folderAccess_grant")
  )!
  expect(grant).toBeDefined()
  expect(grant.disabled).toBe(false)
  const card = container.querySelector("[aria-busy]")!
  expect(card).not.toBeNull()
  expect(card.getAttribute("aria-busy")).toBe("false")
  await act(async () => grant.click())
  expect(boundary.permission).toHaveBeenCalledExactlyOnceWith(
    { name: "Captured folder" },
    true
  )
  expect(grant.disabled).toBe(true)
  expect(card.getAttribute("aria-busy")).toBe("true")
  expect(restart).not.toHaveBeenCalled()
  await act(async () => permission.resolve(true))
  expect(grant.disabled).toBe(false)
  expect(card.getAttribute("aria-busy")).toBe("false")
  expect(restart).not.toHaveBeenCalled()
})
