import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createBackgroundOffscreenEventMessageHandlers } from "@/entrypoints/background/background-offscreen-event-message-handlers"
import { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import { DownloadTaskCancellationCoordinator } from "@/entrypoints/background/download-task-cancellation-coordinator"
import { DestinationService } from "@/entrypoints/background/destination"
import { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import type { DownloadQueueFinalizationDependencies } from "@/entrypoints/background/download-queue-finalization"
import { createDispatchLease } from "@/src/runtime/dispatch-lease"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { createOffscreenDispatchFingerprint } from "@/src/runtime/offscreen-job-fingerprint"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { DownloadTaskState, TaskChapter } from "@/src/domain/queue/state"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { QueueRepository } from "@/src/storage/queue-repository"
import { NativeOutputRepository } from "@/src/storage/native-output-repository"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
import * as fsAccess from "@/src/storage/fs-access"
import {
  buildMangaMillionRegisterResponse,
  buildMangaMillionViewerResponse,
} from "@/tests/e2e/fixtures/mock-data/site-integrations/mangamillion/api-fixtures"
import { MOCK_PLAIN_WEBP_BUFFER } from "@/tests/e2e/fixtures/mock-data/site-integrations/mangamillion/image-fixtures"

type OffscreenDownloadChapterPayload =
  RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_CHAPTER">["payload"]
type OffscreenMessage = {
  target?: string
  type?: string
  payload?: Record<string, unknown>
}
type OffscreenEventHandlers = ReturnType<
  typeof createBackgroundOffscreenEventMessageHandlers
>
type TaskExecutor = {
  execute: ReturnType<typeof vi.fn>
  isActive: (taskId: string) => boolean
}

const COVER_URL =
  "https://img.mangamillion.shueisha.co.jp/jpn/image/original_title_cover/cover-timeout.webp"
const CHAPTER_IMAGE_URL =
  "https://img.mangamillion.shueisha.co.jp/en/translated_chapter_page/6736/1.webp"
const CHAPTER_PAGE_URL =
  "https://mangamillion.shueisha.co.jp/en/title/1/chapter/6736"
const DOCUMENT_INSTANCE_ID = "cover-timeout-document"

const messages: OffscreenMessage[] = []
const eventResponses: unknown[] = []
let offscreenEventHandlers: OffscreenEventHandlers | undefined
let cancelOffscreenJob:
  | ((
      input: RuntimeMessageRequest<"OFFSCREEN_CANCEL_JOB">["payload"]
    ) => object)
  | undefined
let resolveTerminal: ((payload: Record<string, unknown>) => void) | undefined

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
}

class MemoryFile {
  readonly kind = "file" as const
  readonly name: string

  constructor(name: string) {
    this.name = name
  }

  async createWritable(): Promise<{
    write: (value: unknown) => Promise<void>
    close: () => Promise<void>
    abort: () => Promise<void>
  }> {
    return {
      write: async () => undefined,
      close: async () => undefined,
      abort: async () => undefined,
    }
  }
}

class MemoryDirectory {
  readonly kind = "directory" as const
  readonly name: string
  private readonly directories = new Map<string, MemoryDirectory>()
  private readonly files = new Map<string, MemoryFile>()

  constructor(name: string) {
    this.name = name
  }

  async queryPermission(): Promise<PermissionState> {
    return "granted"
  }

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<MemoryDirectory> {
    const existing = this.directories.get(name)
    if (existing) return existing
    if (!options?.create) throw this.notFound(name)
    const directory = new MemoryDirectory(name)
    this.directories.set(name, directory)
    return directory
  }

  async getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<MemoryFile> {
    const existing = this.files.get(name)
    if (existing) return existing
    if (!options?.create) throw this.notFound(name)
    const file = new MemoryFile(name)
    this.files.set(name, file)
    return file
  }

  private notFound(name: string): Error {
    const error = new Error(`Missing file-system entry: ${name}`)
    error.name = "NotFoundError"
    return error
  }
}

function createSettingsSnapshot() {
  return createTaskSettingsSnapshot(
    {
      ...DEFAULT_SETTINGS,
      downloads: {
        ...DEFAULT_SETTINGS.downloads,
        defaultFormat: "none",
        destination: "file-system-access",
        includeComicInfo: false,
        includeCoverImage: true,
      },
      globalPolicy: {
        image: { concurrency: 1, delayMs: 0 },
        chapter: { concurrency: 1, delayMs: 0 },
      },
      globalRetries: { image: 0, chapter: 0 },
      notifications: false,
    },
    "mangamillion"
  )
}

function createChapter(
  id: string,
  title: string,
  status: TaskChapter["status"]
): TaskChapter {
  return {
    id,
    url: CHAPTER_PAGE_URL,
    title,
    index: 1,
    status,
    lastUpdated: 1,
  }
}

function createTask(
  id: string,
  chapterId: string,
  title: string,
  status: DownloadTaskState["status"]
): DownloadTaskState {
  return {
    id,
    siteIntegrationId: "mangamillion",
    mangaId: "cover-timeout-series",
    seriesTitle: "Cover timeout series",
    seriesCoverUrl: COVER_URL,
    chapters: [createChapter(chapterId, title, "queued")],
    status,
    created: 1,
    settingsSnapshot: createSettingsSnapshot(),
  }
}

async function createDispatchRequest(): Promise<{
  payload: OffscreenDownloadChapterPayload
  lease: ReturnType<typeof createDispatchLease>
}> {
  const settingsSnapshot = createSettingsSnapshot()
  const unsigned = {
    jobId: "cover-timeout-job",
    attempt: 1,
    taskId: "cover-timeout-download",
    seriesKey: "mangamillion:cover-timeout-series",
    book: {
      siteIntegrationId: "mangamillion",
      seriesTitle: "Cover timeout series",
      coverUrl: COVER_URL,
    },
    chapter: {
      id: "6736",
      title: "Chapter after cover timeout",
      url: CHAPTER_PAGE_URL,
      index: 1,
      resolvedPath: "Chapter after cover timeout",
    },
    settingsSnapshot,
    saveMode: "fsa" as const,
  }
  const fingerprint = await createOffscreenDispatchFingerprint(unsigned)
  const payload = { ...unsigned, fingerprint }
  return {
    payload,
    lease: createDispatchLease({
      jobId: payload.jobId,
      taskId: payload.taskId,
      chapterId: payload.chapter.id,
      attempt: payload.attempt,
      fingerprint,
      saveMode: payload.saveMode,
      now: 1,
    }),
  }
}

const sendMessage = vi.fn(async (message: OffscreenMessage) => {
  messages.push(message)
  if (message.type === "OFFSCREEN_JOB_TERMINAL" && message.payload) {
    resolveTerminal?.(message.payload)
  }

  if (message.type === "OFFSCREEN_CANCEL_JOB") {
    if (!cancelOffscreenJob) throw new Error("Offscreen worker is not ready")
    return {
      success: true,
      ...cancelOffscreenJob(
        message.payload as RuntimeMessageRequest<"OFFSCREEN_CANCEL_JOB">["payload"]
      ),
    }
  }

  if (message.type === "GET_SITE_INTEGRATION_ENABLEMENT") {
    return { success: true, enablement: { mangamillion: true } }
  }

  if (
    message.target === "background" &&
    message.type !== undefined &&
    message.type.startsWith("OFFSCREEN_")
  ) {
    const handler =
      offscreenEventHandlers?.[message.type as keyof OffscreenEventHandlers]
    if (typeof handler !== "function") {
      throw new Error(`Unexpected offscreen event: ${message.type}`)
    }
    const response = await (
      handler as (value: unknown, sender: unknown) => unknown
    )(message, {
      id: "tako-test",
      url: "chrome-extension://tako-test/offscreen.html",
    })
    eventResponses.push(response)
    return response
  }

  throw new Error(`Unexpected runtime message: ${message.type}`)
})

let OffscreenWorker: typeof import("@/entrypoints/offscreen/main").OffscreenWorker

describe("cover prefetch and chapter processing", () => {
  beforeEach(async () => {
    messages.length = 0
    eventResponses.length = 0
    offscreenEventHandlers = undefined
    resolveTerminal = undefined
    cancelOffscreenJob = undefined
    sendMessage.mockClear()
    vi.stubGlobal("document", {
      addEventListener: vi.fn(),
      getElementById: vi.fn(() => null),
    })
    vi.stubGlobal("chrome", {
      runtime: {
        id: "tako-test",
        getURL: (path: string) => `chrome-extension://tako-test/${path}`,
        sendMessage,
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    })
    ;({ OffscreenWorker } = await import("@/entrypoints/offscreen/main"))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each(["timeout", "cancel", "success"] as const)(
    "releases current work and schedules the next download after cover %s",
    async (coverResult) => {
      vi.useFakeTimers()

      const local: Record<string, unknown> = {
        [LOCAL_STORAGE_KEYS.downloadQueue]: [],
        [LOCAL_STORAGE_KEYS.activeDispatchLease]: null,
        [LOCAL_STORAGE_KEYS.pendingUndoActions]: [],
      }
      const session: Record<string, unknown> = {}
      const localStorage = {
        get: vi.fn(async (keys: string | string[]) => {
          const requested = Array.isArray(keys) ? keys : [keys]
          return Object.fromEntries(
            requested.map((key) => [key, structuredClone(local[key])])
          )
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(local, structuredClone(values))
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys])
            delete local[key]
        }),
      }
      const sessionStorage = {
        get: vi.fn(async (keys: string | string[]) => {
          const requested = Array.isArray(keys) ? keys : [keys]
          return Object.fromEntries(
            requested.map((key) => [key, structuredClone(session[key])])
          )
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(session, structuredClone(values))
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys])
            delete session[key]
        }),
      }
      Object.assign(globalThis.chrome, {
        storage: { local: localStorage, session: sessionStorage },
        action: {
          setBadgeText: vi.fn(async () => undefined),
          setBadgeBackgroundColor: vi.fn(async () => undefined),
        },
      })

      const queueRepository = new QueueRepository(new QueueProjectionService())
      await queueRepository.initialize()
      await queueRepository.enqueueDownloadTask(
        createTask(
          "cover-timeout-download",
          "6736",
          "Chapter after cover timeout",
          "queued"
        )
      )
      await queueRepository.enqueueDownloadTask(
        createTask("next-download", "6739", "Next chapter", "queued")
      )
      expect(
        (
          await queueRepository.startDownloadTask({
            taskId: "cover-timeout-download",
            now: 2,
          })
        ).outcome
      ).toBe("applied")

      const { payload, lease } = await createDispatchRequest()
      expect(
        (
          await queueRepository.beginChapterDispatch({
            taskId: payload.taskId,
            chapterId: payload.chapter.id,
            expectedPreviousLease: null,
            lease,
            now: 3,
          })
        ).outcome
      ).toBe("applied")

      const liveResources = new OffscreenLiveResourceLedger()
      const worker = new OffscreenWorker(DOCUMENT_INSTANCE_ID, liveResources)
      cancelOffscreenJob = (identity) => worker.cancelJob(identity)
      await worker.initialize()
      vi.spyOn(fsAccess, "loadDownloadRootHandle").mockResolvedValue(
        new MemoryDirectory(
          "download-root"
        ) as unknown as FileSystemDirectoryHandle
      )

      const settingsRepository = {
        getSettings: vi.fn(async () => ({
          ...DEFAULT_SETTINGS,
          notifications: false,
        })),
      }
      const historyRepository = {
        getDownloadedChapters: vi.fn(async () => []),
        restoreChapterFromCompletedTask: vi.fn(async () => true),
        markChapterAsDownloaded: vi.fn(async () => undefined),
      }
      const finalizationDependencies: DownloadQueueFinalizationDependencies = {
        settingsRepository,
        historyRepository,
      }
      const nativeRepository = new NativeOutputRepository()
      const nativeCoordinator = new NativeOutputCoordinator({
        settingsRepository,
        repository: nativeRepository,
        queueRepository,
        queryOffscreenJob: async (identity) => worker.getJobState(identity),
        requestBlobRevocation: async () => undefined,
        ensureLivenessAlarm: vi.fn(async () => undefined),
      })
      await nativeCoordinator.initialize()

      const scheduledTaskIds: string[] = []
      const taskExecutor: TaskExecutor = {
        execute: vi.fn(async (taskId: string) => {
          scheduledTaskIds.push(taskId)
          return "wait" as const
        }),
        isActive: () => false,
      }
      const queueScheduler = new QueueScheduler(
        queueRepository,
        taskExecutor as never,
        vi.fn(async () => undefined)
      )
      const cancellationCoordinator = new DownloadTaskCancellationCoordinator(
        queueRepository,
        nativeCoordinator,
        finalizationDependencies
      )
      const destinationService = new DestinationService({
        queueRepository,
        settingsReader: settingsRepository,
        notifier: {
          notifyDestinationActionRequired: vi.fn(async () => undefined),
        },
      })
      const terminalCoordinator = new OffscreenJobTerminalCoordinator(
        queueRepository,
        nativeCoordinator,
        queueScheduler,
        destinationService,
        finalizationDependencies
      )
      offscreenEventHandlers = createBackgroundOffscreenEventMessageHandlers({
        queueRepository,
        nativeOutputCoordinator: nativeCoordinator,
        terminalCoordinator,
      } as never)

      let coverCanceled = false
      const fetchMock = vi.fn(async (url: string) => {
        const pathname = new URL(url).pathname
        if (pathname.endsWith("/api/register")) {
          return new Response(
            toArrayBuffer(buildMangaMillionRegisterResponse()),
            { headers: { "content-type": "application/octet-stream" } }
          )
        }
        if (pathname.endsWith("/api/viewer")) {
          return new Response(
            toArrayBuffer(
              buildMangaMillionViewerResponse({
                aesKey: "",
                aesIv: "",
                pageUrls: [CHAPTER_IMAGE_URL],
              })
            ),
            { headers: { "content-type": "application/octet-stream" } }
          )
        }
        if (url === COVER_URL) {
          if (coverResult === "success")
            return new Response(toArrayBuffer(MOCK_PLAIN_WEBP_BUFFER), {
              headers: { "content-type": "image/webp" },
            })
          return new Response(
            new ReadableStream<Uint8Array>({
              cancel: () => {
                coverCanceled = true
              },
            }),
            { headers: { "content-type": "image/webp" } }
          )
        }
        if (url === CHAPTER_IMAGE_URL) {
          return new Response(toArrayBuffer(MOCK_PLAIN_WEBP_BUFFER), {
            headers: { "content-type": "image/webp" },
          })
        }
        throw new Error(`Unexpected provider request: ${url}`)
      })
      vi.stubGlobal("fetch", fetchMock)

      let resolveTerminalPayload!: (payload: Record<string, unknown>) => void
      const terminalPayload = new Promise<Record<string, unknown>>(
        (resolve) => {
          resolveTerminalPayload = resolve
        }
      )
      resolveTerminal = resolveTerminalPayload

      const acknowledgment = await worker.processDownloadChapter(payload)
      await queueRepository.bindDispatchLeaseIncarnation({
        jobId: acknowledgment.jobId,
        attempt: acknowledgment.attempt,
        taskId: acknowledgment.taskId,
        chapterId: acknowledgment.chapterId,
        fingerprint: acknowledgment.fingerprint,
        documentInstanceId: acknowledgment.documentInstanceId,
      })
      await vi.advanceTimersByTimeAsync(0)
      await vi.waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          COVER_URL,
          expect.objectContaining({ credentials: "omit", redirect: "error" })
        )
      )
      if (coverResult === "cancel") {
        const cancellation = await cancellationCoordinator.cancelTask(
          payload.taskId,
          "cancel-cover-download"
        )
        expect(cancellation.queueCanContinue).toBe(true)
        await vi.advanceTimersByTimeAsync(0)
        await queueScheduler.activate()
        expect(coverCanceled).toBe(true)
        expect(fetchMock).not.toHaveBeenCalledWith(
          CHAPTER_IMAGE_URL,
          expect.anything()
        )
        await expect(
          queueRepository.getActiveDispatchLease()
        ).resolves.toBeNull()
        await expect(
          queueRepository.getTask(payload.taskId)
        ).resolves.toMatchObject({ status: "canceled" })
        expect(scheduledTaskIds).toContain("next-download")
        await vi.waitFor(() => expect(liveResources.getUsedBytes()).toBe(0))
        expect(worker.getActiveJobCount()).toBe(0)
        expect(eventResponses).not.toContainEqual(
          expect.objectContaining({ disposition: "protocol_error" })
        )
        return
      }
      if (coverResult === "timeout") await vi.advanceTimersByTimeAsync(30_001)
      await vi.waitFor(() =>
        expect(messages).toContainEqual(
          expect.objectContaining({ type: "OFFSCREEN_JOB_TERMINAL" })
        )
      )
      expect(eventResponses).not.toContainEqual(
        expect.objectContaining({ disposition: "protocol_error" })
      )
      const terminal = await terminalPayload
      await vi.advanceTimersByTimeAsync(0)

      expect(acknowledgment.accepted).toBe(true)
      expect(coverCanceled).toBe(coverResult === "timeout")
      expect(fetchMock).toHaveBeenCalledWith(
        CHAPTER_IMAGE_URL,
        expect.objectContaining({ credentials: "omit", redirect: "error" })
      )
      expect(terminal.outcome).toMatchObject({
        status: "completed",
        outputsRequested: coverResult === "success" ? 2 : 1,
        outputsFailedBeforeHandoff: 0,
      })
      await vi.waitFor(() =>
        expect(scheduledTaskIds).toContain("next-download")
      )
      await expect(queueRepository.getActiveDispatchLease()).resolves.toBeNull()
      await expect(
        queueRepository.getTask("cover-timeout-download")
      ).resolves.toMatchObject({
        status: "completed",
        chapters: [{ id: "6736", status: "completed" }],
      })
      await expect(nativeCoordinator.hasLiveDependencies()).resolves.toBe(false)
      expect(liveResources.getUsedBytes()).toBe(0)
      expect(worker.getActiveJobCount()).toBe(0)
      expect(eventResponses).not.toContainEqual(
        expect.objectContaining({ disposition: "protocol_error" })
      )
      expect(
        messages.some((message) => message.type === "OFFSCREEN_JOB_TERMINAL")
      ).toBe(true)
    }
  )
})
