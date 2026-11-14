import { afterEach, describe, expect, it, vi } from "vitest"
import { createBackgroundOffscreenEventMessageHandlers } from "@/entrypoints/background/background-offscreen-event-message-handlers"
import { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import { OffscreenWorker } from "@/entrypoints/offscreen/main-worker"
import {
  MAX_CHAPTER_IMAGE_BYTES,
  MAX_METADATA_RESPONSE_BYTES,
} from "@/src/constants/timeouts"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import { createDispatchLease } from "@/src/runtime/dispatch-lease"
import { createOffscreenDispatchFingerprint } from "@/src/runtime/offscreen-job-fingerprint"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import { mapRuntimeMessageFailure } from "@/src/runtime/runtime-message-dispatcher"
import {
  runtimeMessageRegistry,
  type RuntimeMessage,
  type RuntimeMessageRequest,
} from "@/src/runtime/runtime-message-contracts"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import * as fsAccess from "@/src/storage/fs-access"
import { HistoryRepository } from "@/src/storage/history-repository"
import { NativeOutputRepository } from "@/src/storage/native-output-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { QueueRepository } from "@/src/storage/queue-repository"
import { buildMangaMillionViewerResponse } from "@/tests/e2e/fixtures/mock-data/site-integrations/mangamillion/api-fixtures"

// Scale image budgets; the actual metadata cap, transport and writes run intact.
vi.mock("@/src/constants/timeouts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/constants/timeouts")>()),
  MAX_CHAPTER_IMAGE_BYTES: 256,
  MAX_IMAGE_BYTES: 1024 * 1024,
}))

const PAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABoAAAACCAYAAABGz8w4AAAASUlEQVR4nL3NEQKAQAAAsNM0TYMkTdM0PU3TNE3TNE3TNE3TXlJ7RTBeCEV8E1IyckoqahpaIh09AyMTMwsrGzsHJxc3D+Gv6AOqBmUPS959fwAAAABJRU5ErkJggg==",
  "base64"
)
const CHAPTER_URL =
  "https://mangamillion.shueisha.co.jp/en/title/1/chapter/6736"
type TerminalPayload =
  RuntimeMessageRequest<"OFFSCREEN_JOB_TERMINAL">["payload"]

function storageArea(values: Record<string, unknown>) {
  return {
    get: async (keys: string | string[]) =>
      Object.fromEntries(
        [keys]
          .flat()
          .filter((key) => key in values)
          .map((key) => [key, structuredClone(values[key])])
      ),
    set: async (next: Record<string, unknown>) => {
      Object.assign(values, structuredClone(next))
    },
    remove: async (keys: string | string[]) => {
      for (const key of [keys].flat()) delete values[key]
    },
  }
}

function writableDirectory(
  closedFiles: Map<string, Uint8Array>,
  events: string[],
  prefix = ""
): FileSystemDirectoryHandle {
  return {
    getDirectoryHandle: async (name: string) =>
      writableDirectory(closedFiles, events, `${prefix}${name}/`),
    getFileHandle: async (name: string) => ({
      createWritable: async () => {
        const chunks: Uint8Array[] = []
        return {
          write: async (bytes: Uint8Array) => {
            chunks.push(bytes.slice())
          },
          close: async () => {
            const data = new Uint8Array(
              await new Blob(chunks as BlobPart[]).arrayBuffer()
            )
            closedFiles.set(`${prefix}${name}`, data)
            events.push("closed-output")
          },
          abort: async () => undefined,
        }
      },
    }),
  } as unknown as FileSystemDirectoryHandle
}

async function runChapter(
  pageCount: number,
  saveMode: "fsa" | "downloads-api" = "fsa",
  includeComicInfo = false,
  options: { description?: string; liveResourceCapacity?: number } = {}
) {
  const events: string[] = []
  const closedFiles = new Map<string, Uint8Array>()
  const terminal = Promise.withResolvers<TerminalPayload>()
  const responses: unknown[] = []
  const downloads: chrome.downloads.DownloadItem[] = []
  const sender = {
    id: "tako-test",
    url: "chrome-extension://tako-test/offscreen.html",
  }
  const sendMessage = async (message: RuntimeMessage): Promise<unknown> => {
    let response: unknown
    switch (message.type) {
      case "GET_MANGAMILLION_DEVICE_TOKEN":
        return { success: true, deviceToken: "test-token" }
      case "GET_SITE_INTEGRATION_ENABLEMENT":
        return { success: true, enablement: { mangamillion: true } }
      case "OFFSCREEN_JOB_ACCEPTED":
        response = await handlers.OFFSCREEN_JOB_ACCEPTED(message, sender)
        break
      case "OFFSCREEN_JOB_HEARTBEAT":
        response = await handlers.OFFSCREEN_JOB_HEARTBEAT(message, sender)
        break
      case "OFFSCREEN_DOWNLOAD_PROGRESS":
        response = await handlers.OFFSCREEN_DOWNLOAD_PROGRESS(message, sender)
        break
      case "OFFSCREEN_BEGIN_FSA_WRITE":
        response = await handlers.OFFSCREEN_BEGIN_FSA_WRITE(message, sender)
        break
      case "OFFSCREEN_OUTPUT_READY":
        events.push("durable-handoff")
        response = await handlers.OFFSCREEN_OUTPUT_READY(message, sender)
        break
      case "OFFSCREEN_JOB_TERMINAL":
        events.push("terminal")
        try {
          response = await handlers.OFFSCREEN_JOB_TERMINAL(message, sender)
        } catch (error) {
          response = mapRuntimeMessageFailure(
            error,
            "Terminal settlement failed"
          )
        }
        terminal.resolve(message.payload)
        break
      default:
        throw new Error(`Unexpected runtime message: ${message.type}`)
    }
    responses.push(response)
    return response
  }
  const local: Record<string, unknown> = {
    [LOCAL_STORAGE_KEYS.downloadQueue]: [],
    [LOCAL_STORAGE_KEYS.pendingUndoActions]: [],
    [LOCAL_STORAGE_KEYS.activeDispatchLease]: null,
  }
  vi.stubGlobal("chrome", {
    runtime: {
      id: "tako-test",
      getURL: (path: string) => `chrome-extension://tako-test/${path}`,
      sendMessage,
    },
    storage: { local: storageArea(local), session: storageArea({}) },
    downloads: {
      download: async (options: chrome.downloads.DownloadOptions) => {
        const id = downloads.length + 1
        downloads.push({
          id,
          url: options.url,
          finalUrl: options.url,
          referrer: "",
          filename: options.filename ?? "page.png",
          mime: "image/png",
          startTime: new Date().toISOString(),
          state: "in_progress",
          danger: "safe",
          paused: false,
          canResume: false,
          bytesReceived: 0,
          totalBytes: PAGE.byteLength,
          fileSize: PAGE.byteLength,
          incognito: false,
          exists: true,
        })
        return id
      },
      search: async (query: chrome.downloads.DownloadQuery) =>
        downloads.filter(
          (item) => query.id === undefined || query.id === item.id
        ),
    },
  })
  vi.stubGlobal("document", {
    getElementById: () => null,
    addEventListener: () => undefined,
  })
  const settings = structuredClone(DEFAULT_SETTINGS)
  Object.assign(settings.downloads, {
    defaultFormat: "none",
    destination: saveMode === "fsa" ? "file-system-access" : "downloads-api",
    customDirectoryHandleId: saveMode === "fsa" ? "selected-id" : null,
    conflictPolicy: "overwrite",
    includeComicInfo,
    includeCoverImage: false,
  })
  settings.globalPolicy.image = { concurrency: 1, delayMs: 0 }
  settings.globalPolicy.chapter = { concurrency: 1, delayMs: 0 }
  settings.globalRetries = { image: 0, chapter: 0 }
  settings.notifications = false
  const settingsSnapshot = createTaskSettingsSnapshot(settings, "mangamillion")
  const now = Date.now()
  const task: DownloadTaskState = {
    id: `budget-task-${saveMode}-${pageCount}`,
    siteIntegrationId: "mangamillion",
    mangaId: "series",
    seriesTitle: "Series",
    status: "queued",
    created: now,
    settingsSnapshot,
    chapters: [
      {
        id: "6736",
        title: "Chapter",
        url: CHAPTER_URL,
        index: 1,
        requestedPath: "Chapter",
        status: "queued",
        lastUpdated: now,
      },
    ],
  }
  const history = new HistoryRepository()
  const queue = new QueueRepository(new QueueProjectionService(), history)
  await queue.initialize()
  await queue.enqueueDownloadTask(task)
  expect(
    (await queue.startDownloadTask({ taskId: task.id, now })).outcome
  ).toBe("applied")
  const unsigned = {
    jobId: `budget-job-${saveMode}-${pageCount}`,
    attempt: 1,
    taskId: task.id,
    seriesKey: "mangamillion:series",
    book: {
      siteIntegrationId: "mangamillion",
      seriesTitle: "Series",
      ...(options.description
        ? { metadata: { description: options.description } }
        : {}),
    },
    chapter: {
      id: "6736",
      title: "Chapter",
      url: CHAPTER_URL,
      index: 1,
      resolvedPath: "Chapter",
    },
    settingsSnapshot,
    saveMode,
    ...(saveMode === "fsa" ? { directoryHandleId: "selected-id" } : {}),
  }
  const payload = {
    ...unsigned,
    fingerprint: await createOffscreenDispatchFingerprint(unsigned),
  }
  expect(
    (
      await queue.beginChapterDispatch({
        taskId: task.id,
        chapterId: "6736",
        expectedPreviousLease: null,
        lease: createDispatchLease({
          ...payload,
          chapterId: "6736",
          destinationHandleId: saveMode === "fsa" ? "selected-id" : undefined,
          now,
        }),
        now,
      })
    ).outcome
  ).toBe("applied")

  const ledger = new OffscreenLiveResourceLedger(options.liveResourceCapacity)
  const worker = new OffscreenWorker(`budget-document-${pageCount}`, ledger)
  await worker.initialize()
  vi.spyOn(fsAccess, "loadDownloadRootHandle").mockResolvedValue(
    writableDirectory(closedFiles, events)
  )
  const settingsRepository = { getSettings: async () => settings }
  const nativeRepository = new NativeOutputRepository()
  const native = new NativeOutputCoordinator({
    settingsRepository,
    repository: nativeRepository,
    queueRepository: queue,
    queryOffscreenJob: async (identity) => worker.getJobState(identity),
    requestBlobRevocation: async (identity) => {
      expect(worker.revokeBlobUrl(identity)).toBe(true)
    },
    ensureLivenessAlarm: async () => undefined,
  })
  await native.initialize()
  const terminalCoordinator = new OffscreenJobTerminalCoordinator(
    queue,
    native,
    new QueueScheduler(
      queue,
      { execute: async () => "wait", isActive: () => false } as never,
      async () => undefined
    ),
    { settingsRepository, historyRepository: history }
  )
  const handlers = createBackgroundOffscreenEventMessageHandlers({
    queueRepository: queue,
    nativeOutputCoordinator: native,
    terminalCoordinator,
  } as never)
  const pageUrls = Array.from(
    { length: pageCount },
    (_, index) =>
      `https://img.mangamillion.shueisha.co.jp/en/translated_chapter_page/6736/${index + 1}.png`
  )
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const pathname = new URL(url).pathname
      if (pathname.endsWith("/api/viewer")) {
        return new Response(
          new Uint8Array(
            buildMangaMillionViewerResponse({ aesKey: "", aesIv: "", pageUrls })
          ).buffer,
          { headers: { "content-type": "application/octet-stream" } }
        )
      }
      if (pageUrls.includes(url)) {
        events.push(`fetch-page-${pageUrls.indexOf(url) + 1}`)
        return new Response(PAGE.slice(), {
          headers: { "content-type": "image/png" },
        })
      }
      throw new Error(`Unexpected provider request: ${url}`)
    })
  )
  runtimeMessageRegistry.OFFSCREEN_DOWNLOAD_CHAPTER.request.parse({
    target: "offscreen",
    type: "OFFSCREEN_DOWNLOAD_CHAPTER",
    payload,
  })
  const ack = await worker.processDownloadChapter(payload)
  expect(ack.accepted).toBe(true)
  expect((await queue.bindDispatchLeaseIncarnation(ack)).outcome).toBe(
    "applied"
  )
  const terminalPayload = await terminal.promise
  await vi.waitFor(() => expect(worker.getActiveJobCount()).toBe(0))
  expect(responses).not.toContainEqual(
    expect.objectContaining({ disposition: "protocol_error" })
  )
  if (saveMode === "fsa") {
    expect(ledger.getUsedBytes()).toBe(0)
    await expect(queue.getActiveDispatchLease()).resolves.toBeNull()
  }

  const hydratedQueue = new QueueRepository(
    new QueueProjectionService(),
    new HistoryRepository()
  )
  await hydratedQueue.initialize()
  return {
    terminalPayload,
    persisted: await hydratedQueue.getTask(task.id),
    closedFiles,
    events,
    responses,
    queue,
    native,
    nativeRepository,
    terminalCoordinator,
    downloads,
    ledger,
    history,
  }
}

async function completeChromeDownload(
  result: Awaited<ReturnType<typeof runChapter>>
) {
  const download = result.downloads[0]
  download.state = "complete"
  const completed = await result.native.handleDownloadChanged({
    id: download.id,
    state: { current: "complete" },
  })
  await result.terminalCoordinator.continueAfterNativeOutputSettlement(
    completed.effects
  )
  expect(result.ledger.getUsedBytes()).toBe(0)
  await expect(result.queue.getActiveDispatchLease()).resolves.toBeNull()
  return (await result.queue.getTask(result.terminalPayload.taskId))
    ?.chapters[0]
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("loose-file output budget settlement", () => {
  it("persists successful closed output when the chapter fits its aggregate budget", async () => {
    const result = await runChapter(1)
    expect([...result.closedFiles.values()]).toEqual([new Uint8Array(PAGE)])
    expect(result.terminalPayload.outcome).toMatchObject({
      status: "completed",
      outputsRequested: 1,
      outputsCommitted: 1,
    })
    expect(result.persisted?.chapters[0]).toMatchObject({
      status: "completed",
      outputs: { requested: 1, committed: 1, failed: 0 },
      outputDestination: "fsa",
      saveConfirmedAt: expect.any(Number),
    })
  })

  it("retains known closed output when a later page exceeds the aggregate budget", async () => {
    const result = await runChapter(2, "fsa", true)
    expect([...result.closedFiles.values()]).toEqual([new Uint8Array(PAGE)])
    expect(result.events).toEqual([
      "fetch-page-1",
      "closed-output",
      "fetch-page-2",
      "terminal",
    ])
    expect(result.terminalPayload.outcome.errorMessage).toContain(
      `Chapter image bytes exceed ${MAX_CHAPTER_IMAGE_BYTES} byte limit`
    )
    expect.soft(result.terminalPayload.outcome).toMatchObject({
      status: "partial_success",
      errorCategory: "unknown",
      outputsRequested: 3,
      outputsCommitted: 1,
    })
    expect.soft(result.persisted?.chapters[0]).toMatchObject({
      status: "partial_success",
      errorCategory: "unknown",
      outputs: { requested: 3, committed: 1, failed: 2 },
      outputDestination: "fsa",
    })
    expect(result.persisted?.chapters[0].saveConfirmedAt).toBeUndefined()
  })

  it("fails a folder chapter with no closed output when the live ledger rejects the first page", async () => {
    const result = await runChapter(1, "fsa", false, {
      liveResourceCapacity: 0,
    })
    expect(result.events).not.toContain("closed-output")
    expect([...result.closedFiles.values()]).toEqual([])
    expect(result.terminalPayload.outcome).toMatchObject({
      status: "failed",
      errorMessage: expect.stringContaining(
        "Offscreen live resource cap exceeded"
      ),
      imagesFailed: 1,
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 0,
    })
    expect(result.persisted?.chapters[0]).toMatchObject({
      status: "failed",
      outputs: { requested: 1, committed: 0, failed: 1 },
      outputDestination: "fsa",
    })
    expect(result.persisted?.chapters[0].saveConfirmedAt).toBeUndefined()
  })

  it("seals a declared Chrome manifest after a later page exceeds the aggregate budget", async () => {
    const result = await runChapter(2, "downloads-api")
    expect(result.events).toEqual([
      "fetch-page-1",
      "durable-handoff",
      "fetch-page-2",
      "terminal",
    ])
    const snapshot = await result.nativeRepository.snapshot()
    expect(Object.values(snapshot.outputsByOutputId)).toMatchObject([
      { phase: "waiting", outputCount: 2 },
    ])
    expect.soft(result.terminalPayload.outcome).toMatchObject({
      status: "partial_success",
      errorCategory: "unknown",
      outputsRequested: 2,
      outputsCommitted: 0,
      outputsFailedBeforeHandoff: 1,
    })
    expect
      .soft(snapshot.manifestsByJobId[result.terminalPayload.jobId])
      .toMatchObject({
        phase: "sealed",
        outputsRequested: 2,
        outputsFailedBeforeHandoff: 1,
      })
    expect
      .soft(result.responses)
      .not.toContainEqual(expect.objectContaining({ success: false }))
    const chapter = await completeChromeDownload(result)
    expect(chapter).toMatchObject({
      status: "partial_success",
      errorCategory: "unknown",
      outputs: { requested: 2, committed: 1, failed: 1 },
      outputDestination: "downloads-api",
    })
    expect(chapter?.errorMessage).toContain(
      `Chapter image bytes exceed ${MAX_CHAPTER_IMAGE_BYTES} byte limit`
    )
  })

  it.each(["fsa", "downloads-api"] as const)(
    "retains prior %s output when admitted metadata expands beyond the real XML limit",
    async (saveMode) => {
      const result = await runChapter(1, saveMode, true, {
        description: "&".repeat(2_100_000),
      })
      expect(result.events).toEqual([
        "fetch-page-1",
        saveMode === "fsa" ? "closed-output" : "durable-handoff",
        "terminal",
      ])
      expect(result.terminalPayload.outcome.errorMessage).toContain(
        `ComicInfo bytes exceed ${MAX_METADATA_RESPONSE_BYTES} byte limit`
      )
      expect(result.terminalPayload.outcome.imagesFailed).toBeUndefined()
      expect.soft(result.terminalPayload.outcome).toMatchObject({
        status: "partial_success",
        errorCategory: "unknown",
        outputsRequested: 2,
        outputsCommitted: saveMode === "fsa" ? 1 : 0,
        outputsFailedBeforeHandoff: saveMode === "fsa" ? 0 : 1,
      })
      let chapter = result.persisted?.chapters[0]
      if (saveMode === "fsa") {
        expect([...result.closedFiles.values()]).toEqual([new Uint8Array(PAGE)])
      } else {
        const snapshot = await result.nativeRepository.snapshot()
        expect
          .soft(snapshot.manifestsByJobId[result.terminalPayload.jobId])
          .toMatchObject({
            phase: "sealed",
            outputsRequested: 2,
            outputsFailedBeforeHandoff: 1,
          })
        expect
          .soft(result.responses)
          .not.toContainEqual(expect.objectContaining({ success: false }))
        chapter = await completeChromeDownload(result)
      }
      expect.soft(chapter).toMatchObject({
        status: "partial_success",
        errorCategory: "unknown",
        outputs: { requested: 2, committed: 1, failed: 1 },
      })
      expect(chapter?.saveConfirmedAt).toBeUndefined()
      expect(await result.history.getDownloadedChapters()).toEqual([])
    }
  )

  it("completes metadata when closed folder output releases the shared live budget", async () => {
    const result = await runChapter(1, "fsa", true, {
      liveResourceCapacity: MAX_METADATA_RESPONSE_BYTES,
    })
    expect(result.closedFiles.size).toBe(2)
    expect(result.terminalPayload.outcome).toMatchObject({
      status: "completed",
      outputsRequested: 2,
      outputsCommitted: 2,
    })
    expect(result.persisted?.chapters[0]).toMatchObject({
      status: "completed",
      outputs: { requested: 2, committed: 2, failed: 0 },
      saveConfirmedAt: expect.any(Number),
    })
  })

  it("retains a Chrome handoff when metadata reservation exceeds the shared live budget", async () => {
    const result = await runChapter(1, "downloads-api", true, {
      liveResourceCapacity: MAX_METADATA_RESPONSE_BYTES,
    })
    expect(result.events).toEqual([
      "fetch-page-1",
      "durable-handoff",
      "terminal",
    ])
    expect(result.terminalPayload.outcome.errorMessage).toContain(
      "Offscreen live resource cap exceeded"
    )
    expect(result.terminalPayload.outcome.imagesFailed).toBeUndefined()
    expect.soft(result.terminalPayload.outcome).toMatchObject({
      status: "partial_success",
      errorCategory: "unknown",
      outputsRequested: 2,
      outputsCommitted: 0,
      outputsFailedBeforeHandoff: 1,
    })
    const snapshot = await result.nativeRepository.snapshot()
    expect
      .soft(snapshot.manifestsByJobId[result.terminalPayload.jobId])
      .toMatchObject({
        phase: "sealed",
        outputsRequested: 2,
        outputsFailedBeforeHandoff: 1,
      })
    const chapter = await completeChromeDownload(result)
    expect(chapter).toMatchObject({
      status: "partial_success",
      errorCategory: "unknown",
      outputs: { requested: 2, committed: 1, failed: 1 },
    })
    expect(chapter?.errorMessage).toContain(
      "Offscreen live resource cap exceeded"
    )
    expect(chapter?.saveConfirmedAt).toBeUndefined()
    expect(await result.history.getDownloadedChapters()).toEqual([])
  })
})
