import { setImmediate as nextTurn } from "node:timers/promises"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createBackgroundOffscreenEventMessageHandlers } from "@/entrypoints/background/background-offscreen-event-message-handlers"
import { BackgroundDownloadStateQueryService } from "@/entrypoints/background/download-state-query-service"
import { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import { OptionsConfigurationService } from "@/entrypoints/background/options-configuration-service"
import { QueueApplicationCommands } from "@/entrypoints/background/queue-application-commands"
import { OffscreenWorker } from "@/entrypoints/offscreen/main-worker"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createDispatchLease } from "@/src/runtime/dispatch-lease"
import { createOffscreenDispatchFingerprint } from "@/src/runtime/offscreen-job-fingerprint"
import {
  runtimeMessageRegistry,
  type RuntimeMessage,
  type RuntimeMessageRequest,
} from "@/src/runtime/runtime-message-contracts"
import { classifyRuntimeMessagePrincipal } from "@/src/runtime/runtime-message-sender"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { HistoryRepository } from "@/src/storage/history-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { QueueRepository } from "@/src/storage/queue-repository"
import { SettingsRepository } from "@/src/storage/settings-repository"
import { SiteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"
import {
  buildMangaMillionRegisterResponse,
  buildMangaMillionViewerResponse,
} from "@/tests/e2e/fixtures/mock-data/site-integrations/mangamillion/api-fixtures"

type Terminal = RuntimeMessageRequest<"OFFSCREEN_JOB_TERMINAL">["payload"]
const PAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABoAAAACCAYAAABGz8w4AAAASUlEQVR4nL3NEQKAQAAAsNM0TYMkTdM0PU3TNE3TNE3TNE3TXlJ7RTBeCEV8E1IyckoqahpaIh09AyMTMwsrGzsHJxc3D+Gv6AOqBmUPS959fwAAAABJRU5ErkJggg==",
  "base64"
)
const PAGE_URL =
  "https://img.mangamillion.shueisha.co.jp/en/translated_chapter_page/6736/1.png"
const CHAPTER_URL =
  "https://mangamillion.shueisha.co.jp/en/title/1/chapter/6736"

function storageArea(values: Record<string, unknown>) {
  return {
    get: async (keys: string | string[]) =>
      Object.fromEntries(
        [keys].flat().map((key) => [key, structuredClone(values[key])])
      ),
    set: async (next: Record<string, unknown>) => {
      Object.assign(values, structuredClone(next))
    },
    remove: async (keys: string | string[]) => {
      for (const key of [keys].flat()) delete values[key]
    },
  }
}

function exposeRoot(root: object) {
  const transaction = {
    objectStore: () => ({
      get: (key: string) => {
        const request = {
          result: key === "captured-folder" ? root : undefined,
          onsuccess: undefined as (() => void) | undefined,
        }
        queueMicrotask(() => {
          request.onsuccess?.()
          transaction.oncomplete?.()
        })
        return request
      },
    }),
    oncomplete: undefined as (() => void) | undefined,
  }
  vi.stubGlobal("indexedDB", {
    open: () => {
      const request = {
        result: { transaction: () => transaction, close: () => undefined },
        onsuccess: undefined as (() => void) | undefined,
      }
      queueMicrotask(() => request.onsuccess?.())
      return request
    },
  })
}

async function fixture(optIn: boolean) {
  const events: string[] = []
  const closedFiles = new Map<string, Uint8Array>()
  const permitRequested = Promise.withResolvers<void>()
  const releasePermit = Promise.withResolvers<void>()
  const terminal = Promise.withResolvers<Terminal>()
  const beginResponses: unknown[] = []
  let beginCount = 0
  const local: Record<string, unknown> = {}
  const history = new HistoryRepository()
  const queue = new QueueRepository(new QueueProjectionService(), history)
  const coldQueue = () =>
    new QueueRepository(new QueueProjectionService(), new HistoryRepository())
  const sender = {
    id: "fsa-consent",
    url: "chrome-extension://fsa-consent/offscreen.html",
    documentId: "browser-fsa-document",
  }
  const handlers = createBackgroundOffscreenEventMessageHandlers({
    queueRepository: queue,
    historyRepository: history,
    settingsRepository: new SettingsRepository("warn"),
    siteIntegrationEnablementService: vi.mockObject(
      SiteIntegrationEnablementService.prototype
    ),
    queueApplicationCommands: vi.mockObject(QueueApplicationCommands.prototype),
    nativeOutputCoordinator: vi.mockObject(NativeOutputCoordinator.prototype),
    terminalCoordinator: vi.mockObject(
      OffscreenJobTerminalCoordinator.prototype
    ),
    downloadStateQueryService: vi.mockObject(
      BackgroundDownloadStateQueryService.prototype
    ),
    optionsConfigurationService: vi.mockObject(
      OptionsConfigurationService.prototype
    ),
    coverPreviewHandlers: {
      GET_COVER_PREVIEW: async () => {
        throw new Error("Unexpected cover preview request")
      },
      CANCEL_COVER_PREVIEW: async () => {
        throw new Error("Unexpected cover cancellation")
      },
    },
    ensureOffscreenDocumentReady: async () => undefined,
    tabContextResolver: { resolveTabContext: async () => undefined },
  })
  vi.stubGlobal("chrome", {
    runtime: {
      id: sender.id,
      getURL: (path: string) =>
        `chrome-extension://${sender.id}/${path.replace(/^\//, "")}`,
      getContexts: async () => [
        {
          contextType: "OFFSCREEN_DOCUMENT",
          documentUrl: sender.url,
          documentId: sender.documentId,
        },
      ],
      sendMessage: async (message: RuntimeMessage): Promise<unknown> => {
        switch (message.type) {
          case "GET_SITE_INTEGRATION_ENABLEMENT":
            return { success: true, enablement: { mangamillion: true } }
          case "OFFSCREEN_JOB_ACCEPTED":
            return await handlers.OFFSCREEN_JOB_ACCEPTED(message, sender)
          case "OFFSCREEN_JOB_HEARTBEAT":
            return await handlers.OFFSCREEN_JOB_HEARTBEAT(message, sender)
          case "OFFSCREEN_BEGIN_FSA_WRITE": {
            beginCount++
            events.push("permit-requested")
            expect(classifyRuntimeMessagePrincipal(sender, sender.id)).toBe(
              "offscreen"
            )
            runtimeMessageRegistry.OFFSCREEN_BEGIN_FSA_WRITE.request.parse(
              message
            )
            permitRequested.resolve()
            await releasePermit.promise
            const response = await handlers.OFFSCREEN_BEGIN_FSA_WRITE(
              message,
              sender
            )
            beginResponses.push(response)
            if (response.success && response.permitted)
              events.push("permit-accepted")
            return response
          }
          case "OFFSCREEN_DOWNLOAD_PROGRESS":
            return { success: true, disposition: "renewed" }
          case "OFFSCREEN_JOB_TERMINAL":
            terminal.resolve(message.payload)
            return { success: true, disposition: "renewed" }
          default:
            throw new Error(`Unexpected worker request: ${message.type}`)
        }
      },
    },
    storage: { local: storageArea(local), session: storageArea({}) },
    action: {
      setBadgeText: async () => undefined,
      setBadgeBackgroundColor: async () => undefined,
    },
  })
  const settings = structuredClone(DEFAULT_SETTINGS)
  Object.assign(settings.downloads, {
    destination: "file-system-access",
    customDirectoryHandleId: "captured-folder",
    allowChromeFallback: optIn,
    defaultFormat: "none",
    conflictPolicy: "overwrite",
    includeComicInfo: false,
    includeCoverImage: false,
  })
  settings.globalPolicy.image = { concurrency: 1, delayMs: 0 }
  settings.globalPolicy.chapter = { concurrency: 1, delayMs: 0 }
  settings.globalRetries = { image: 0, chapter: 0 }
  const snapshot = createTaskSettingsSnapshot(settings, "mangamillion")
  const task: DownloadTaskState = {
    id: "fsa-task",
    siteIntegrationId: "mangamillion",
    mangaId: "series",
    seriesTitle: "Series",
    created: 100,
    status: "queued",
    ...(optIn ? { fsaFallbackEligible: true } : {}),
    settingsSnapshot: snapshot,
    chapters: [
      {
        id: "6736",
        title: "Chapter",
        url: CHAPTER_URL,
        requestedPath: "Chapter",
        index: 0,
        status: "queued",
        lastUpdated: 100,
      },
    ],
  }
  await queue.enqueueDownloadTask(task)
  await queue.startDownloadTask({ taskId: task.id, now: 200 })
  const unsigned = {
    jobId: "fsa-job",
    attempt: 1,
    taskId: task.id,
    seriesKey: "mangamillion:series",
    book: { siteIntegrationId: "mangamillion", seriesTitle: "Series" },
    chapter: {
      id: "6736",
      title: "Chapter",
      url: CHAPTER_URL,
      index: 0,
      resolvedPath: "Chapter",
    },
    settingsSnapshot: snapshot,
    saveMode: "fsa" as const,
    directoryHandleId: "captured-folder",
  }
  const payload = {
    ...unsigned,
    fingerprint: await createOffscreenDispatchFingerprint(unsigned),
  }
  await queue.beginChapterDispatch({
    taskId: task.id,
    chapterId: "6736",
    expectedPreviousLease: null,
    lease: createDispatchLease({
      ...payload,
      chapterId: "6736",
      destinationHandleId: "captured-folder",
      now: 300,
    }),
    now: 300,
  })
  const assertPermit = async () => {
    expect(
      (await coldQueue().getTask(task.id))?.fsaFallbackEligible
    ).toBeUndefined()
    if (optIn) expect(events).toContain("permit-accepted")
  }
  const directory = (prefix: string): object => ({
    queryPermission: async () => "granted",
    getDirectoryHandle: async (name: string) => {
      await assertPermit()
      events.push("directory-mutation")
      return directory(`${prefix}${name}/`)
    },
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (options?.create) {
        await assertPermit()
        events.push("file-mutation")
      }
      return {
        createWritable: async () => {
          await assertPermit()
          const chunks: Uint8Array[] = []
          return {
            write: async (value: unknown) => {
              if (value instanceof Blob)
                chunks.push(new Uint8Array(await value.arrayBuffer()))
              else if (value instanceof Uint8Array) chunks.push(value.slice())
              else throw new Error("Unexpected filesystem chunk")
            },
            close: async () => {
              const bytes = new Uint8Array(
                chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
              )
              let position = 0
              for (const chunk of chunks) {
                bytes.set(chunk, position)
                position += chunk.byteLength
              }
              closedFiles.set(`${prefix}${name}`, bytes)
              events.push("stream-closed")
            },
            abort: async () => undefined,
          }
        },
      }
    },
  })
  exposeRoot(directory(""))
  vi.stubGlobal("document", {
    getElementById: () => null,
    addEventListener: () => undefined,
  })
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const pathname = new URL(url).pathname
    if (pathname.endsWith("/api/register"))
      return new Response(
        new Uint8Array(buildMangaMillionRegisterResponse()).buffer,
        {
          headers: { "content-type": "application/octet-stream" },
        }
      )
    if (pathname.endsWith("/api/viewer"))
      return new Response(
        new Uint8Array(
          buildMangaMillionViewerResponse({
            aesKey: "",
            aesIv: "",
            pageUrls: [PAGE_URL],
          })
        ).buffer,
        {
          headers: { "content-type": "application/octet-stream" },
        }
      )
    if (url === PAGE_URL)
      return new Response(PAGE.slice(), {
        headers: { "content-type": "image/png" },
      })
    throw new Error(`Unexpected provider request: ${url}`)
  })
  const worker = new OffscreenWorker("worker-fsa-document")
  await worker.initialize()
  const ack = await worker.processDownloadChapter(payload)
  expect(ack.accepted).toBe(true)
  expect((await queue.bindDispatchLeaseIncarnation(ack)).outcome).toBe(
    "applied"
  )
  return {
    worker,
    payload,
    terminal,
    permitRequested,
    releasePermit,
    closedFiles,
    events,
    beginResponses,
    beginCount: () => beginCount,
    coldQueue,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("worker first-write consent", () => {
  it("consumes opt-in fallback eligibility durably before the worker mutates or closes folder output", async () => {
    const runtime = await fixture(true)
    try {
      const first = await Promise.race([
        runtime.permitRequested.promise.then(() => "permit-requested"),
        runtime.terminal.promise.then(() => "terminal-before-permit"),
      ])
      expect(first).toBe("permit-requested")
      expect(
        (await runtime.coldQueue().getTask("fsa-task"))?.fsaFallbackEligible
      ).toBe(true)
      expect(runtime.events).toEqual(["permit-requested"])
      runtime.releasePermit.resolve()
      const terminal = await runtime.terminal.promise
      expect(terminal.outcome).toMatchObject({
        status: "completed",
        outputsRequested: 1,
        outputsCommitted: 1,
      })
      expect(runtime.beginResponses).toEqual([
        { success: true, permitted: true },
      ])
      expect(runtime.closedFiles.size).toBe(1)
      expect([...runtime.closedFiles.values()][0].byteLength).toBeGreaterThan(0)
      expect(runtime.events.indexOf("permit-accepted")).toBeLessThan(
        runtime.events.indexOf("file-mutation")
      )
      expect(runtime.events.at(-1)).toBe("stream-closed")
      await nextTurn()
      expect(runtime.worker.getActiveJobCount()).toBe(0)
    } finally {
      runtime.releasePermit.resolve()
      await runtime.terminal.promise
      await nextTurn()
    }
  })

  it("writes and closes non-opt-in folder output without sending a first-write command", async () => {
    const runtime = await fixture(false)
    const terminal = await runtime.terminal.promise
    expect(terminal.outcome).toMatchObject({
      status: "completed",
      outputsCommitted: 1,
    })
    expect(runtime.beginCount()).toBe(0)
    expect(runtime.closedFiles.size).toBe(1)
    expect(runtime.events.at(-1)).toBe("stream-closed")
    await nextTurn()
    expect(runtime.worker.getActiveJobCount()).toBe(0)
  })
})
