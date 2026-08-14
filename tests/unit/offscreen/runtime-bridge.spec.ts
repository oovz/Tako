import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  createOffscreenRuntimeReadinessController,
  registerOffscreenRuntime,
} from "@/entrypoints/offscreen/runtime-bridge"
import type { OffscreenWorkerRuntime } from "@/entrypoints/offscreen/offscreen-runtime-message-handlers"

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const backgroundSender = {
  id: "test-extension",
} as chrome.runtime.MessageSender

const FINGERPRINT = "a".repeat(64)
const DOCUMENT_INSTANCE_ID = "document-instance-1"
const RATE_LIMIT_SETTINGS = {
  image: { concurrency: 1, delayMs: 0 },
  chapter: { concurrency: 1, delayMs: 0 },
}

function jobIdentity(index: number) {
  return {
    jobId: `job-${index}`,
    attempt: 1,
    taskId: "task-1",
    chapterId: `chapter-${index}`,
    fingerprint: FINGERPRINT,
    documentInstanceId: DOCUMENT_INSTANCE_ID,
  }
}

function createWorker(initialize: () => Promise<void>): OffscreenWorkerRuntime {
  return {
    documentInstanceId: DOCUMENT_INSTANCE_ID,
    initialize: vi.fn(initialize),
    processDownloadChapter: vi.fn(),
    parseSeriesHtml: vi.fn(),
    cancelSeriesHtml: vi.fn(() => true),
    cancelJob: vi.fn((identity) => ({
      canceled: true,
      ...identity,
      status: "canceled" as const,
      lastSequence: 1,
    })),
    revokeBlobUrl: vi.fn(() => true),
    getJobState: vi.fn(() => null),
    getActiveJobCount: vi.fn(() => 0),
    getActiveSeriesResolutionCount: vi.fn(() => 0),
    getActiveTaskIds: vi.fn(() => []),
  }
}

describe("offscreen runtime bridge", () => {
  const addListener = vi.fn()
  const sendMessage = vi.fn()
  const onInitialized = vi.fn()
  const onInitializationError = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    sendMessage.mockResolvedValue({ success: true })
    vi.stubGlobal("chrome", {
      runtime: {
        id: "test-extension",
        sendMessage,
        onMessage: { addListener },
      },
    } as unknown as typeof chrome)
  })

  it("installs the listener before asynchronous initialization starts", () => {
    const order: string[] = []
    addListener.mockImplementation(() => order.push("listener"))
    const worker = createWorker(async () => {
      order.push("initialize")
    })

    registerOffscreenRuntime(worker, {
      onInitialized,
      onInitializationError,
    })

    expect(order).toEqual(["listener", "initialize"])
  })

  it("claims only messages with the literal offscreen target", () => {
    const worker = createWorker(() => new Promise<void>(() => undefined))
    registerOffscreenRuntime(worker, {
      onInitialized,
      onInitializationError,
    })
    const listener = addListener.mock.calls[0]?.[0]
    const sendResponse = vi.fn()

    expect(
      listener(
        { target: "background", type: "OFFSCREEN_STATUS" },
        backgroundSender,
        sendResponse
      )
    ).toBe(false)
    expect(listener(null, backgroundSender, sendResponse)).toBe(false)
    expect(sendResponse).not.toHaveBeenCalled()
  })

  it("serves control-ready status while initialization is pending", async () => {
    const worker = createWorker(() => new Promise<void>(() => undefined))
    registerOffscreenRuntime(worker, {
      onInitialized,
      onInitializationError,
    })
    const listener = addListener.mock.calls[0]?.[0]
    const sendResponse = vi.fn()

    expect(
      listener(
        { target: "offscreen", type: "OFFSCREEN_STATUS" },
        backgroundSender,
        sendResponse
      )
    ).toBe(true)
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        initializationState: "initializing",
        documentInstanceId: DOCUMENT_INSTANCE_ID,
        activeJobCount: 0,
        activeSeriesResolutionCount: 0,
        activeTaskIds: [],
      })
    )
  })

  it("routes an exact job query without substituting the current job", async () => {
    const worker = createWorker(async () => undefined)
    const identity = {
      jobId: "job-old",
      attempt: 1,
      taskId: "task-1",
      chapterId: "chapter-1",
      fingerprint: FINGERPRINT,
      documentInstanceId: DOCUMENT_INSTANCE_ID,
    }
    vi.mocked(worker.getJobState).mockReturnValue({
      ...identity,
      status: "canceled",
      stage: "saving",
      lastSequence: 4,
    })
    registerOffscreenRuntime(worker, {
      onInitialized,
      onInitializationError,
    })
    await vi.waitFor(() => expect(onInitialized).toHaveBeenCalledOnce())
    const listener = addListener.mock.calls[0]?.[0]
    const sendResponse = vi.fn()

    expect(
      listener(
        {
          target: "offscreen",
          type: "OFFSCREEN_QUERY_JOB",
          payload: { requestId: "request-1", identity },
        },
        backgroundSender,
        sendResponse
      )
    ).toBe(true)

    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        requestId: "request-1",
        job: expect.objectContaining({
          jobId: "job-old",
          status: "canceled",
        }),
      })
    )
    expect(worker.getJobState).toHaveBeenCalledWith(identity)
  })

  it("reports ready after initialization completes", async () => {
    const worker = createWorker(async () => undefined)
    registerOffscreenRuntime(worker, {
      onInitialized,
      onInitializationError,
    })
    await vi.waitFor(() => expect(onInitialized).toHaveBeenCalledOnce())
    const listener = addListener.mock.calls[0]?.[0]
    const sendResponse = vi.fn()

    listener(
      { target: "offscreen", type: "OFFSCREEN_STATUS" },
      backgroundSender,
      sendResponse
    )

    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        initializationState: "ready",
        documentInstanceId: DOCUMENT_INSTANCE_ID,
        activeJobCount: 0,
        activeSeriesResolutionCount: 0,
        activeTaskIds: [],
      })
    )
  })

  it("buffers runtime-ready work FIFO until initialization completes", async () => {
    let resolveInitialize!: () => void
    const worker = createWorker(
      () =>
        new Promise<void>((resolve) => {
          resolveInitialize = resolve
        })
    )
    registerOffscreenRuntime(worker, {
      onInitialized,
      onInitializationError,
    })
    const listener = addListener.mock.calls[0]?.[0]
    const responses = [vi.fn(), vi.fn()]

    for (const [index, sendResponse] of responses.entries()) {
      expect(
        listener(
          {
            target: "offscreen",
            type: "OFFSCREEN_CANCEL_JOB",
            payload: jobIdentity(index),
          },
          backgroundSender,
          sendResponse
        )
      ).toBe(true)
    }
    expect(worker.cancelJob).not.toHaveBeenCalled()

    resolveInitialize()

    await vi.waitFor(() => expect(worker.cancelJob).toHaveBeenCalledTimes(2))
    expect(
      vi.mocked(worker.cancelJob).mock.calls.map(([value]) => value.jobId)
    ).toEqual(["job-0", "job-1"])
    expect(responses[0]).toHaveBeenCalledWith({
      success: true,
      canceled: true,
      ...jobIdentity(0),
      status: "canceled",
      lastSequence: 1,
    })
    expect(responses[1]).toHaveBeenCalledWith({
      success: true,
      canceled: true,
      ...jobIdentity(1),
      status: "canceled",
      lastSequence: 1,
    })
  })

  it("admits 32 pending work requests and immediately rejects the 33rd", async () => {
    let resolveInitialize!: () => void
    const worker = createWorker(
      () =>
        new Promise<void>((resolve) => {
          resolveInitialize = resolve
        })
    )
    registerOffscreenRuntime(worker, {
      onInitialized,
      onInitializationError,
    })
    const listener = addListener.mock.calls[0]?.[0]
    const responses = Array.from({ length: 33 }, () => vi.fn())

    const sendWorkRequest = (index: number): boolean =>
      listener(
        {
          target: "offscreen",
          type: "OFFSCREEN_CANCEL_JOB",
          payload: jobIdentity(index),
        },
        backgroundSender,
        responses[index]
      )

    for (let index = 0; index < 32; index += 1) {
      expect(sendWorkRequest(index)).toBe(true)
    }

    const statusResponse = vi.fn()
    expect(
      listener(
        { target: "offscreen", type: "OFFSCREEN_STATUS" },
        backgroundSender,
        statusResponse
      )
    ).toBe(true)
    await vi.waitFor(() =>
      expect(statusResponse).toHaveBeenCalledWith({
        success: true,
        initializationState: "initializing",
        documentInstanceId: DOCUMENT_INSTANCE_ID,
        activeJobCount: 0,
        activeSeriesResolutionCount: 0,
        activeTaskIds: [],
      })
    )

    expect(sendWorkRequest(32)).toBe(true)
    await vi.waitFor(() =>
      expect(responses[32]).toHaveBeenCalledWith({
        success: false,
        error: "Offscreen initialization work queue is full",
      })
    )
    for (const sendResponse of responses.slice(0, 32)) {
      expect(sendResponse).not.toHaveBeenCalled()
    }
    expect(worker.cancelJob).not.toHaveBeenCalled()

    resolveInitialize()

    await vi.waitFor(() => expect(worker.cancelJob).toHaveBeenCalledTimes(32))
    expect(
      vi.mocked(worker.cancelJob).mock.calls.map(([value]) => value.jobId)
    ).toEqual(Array.from({ length: 32 }, (_, index) => `job-${index}`))
    for (const [index, sendResponse] of responses.slice(0, 32).entries()) {
      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        canceled: true,
        ...jobIdentity(index),
        status: "canceled",
        lastSequence: 1,
      })
    }
    expect(responses[32]).toHaveBeenCalledOnce()
  })

  it("starts buffered handlers FIFO while allowing concurrent completion", async () => {
    let resolveInitialize!: () => void
    let resolveFirstHandler!: () => void
    const starts: string[] = []
    const worker = createWorker(
      () =>
        new Promise<void>((resolve) => {
          resolveInitialize = resolve
        })
    )
    worker.parseSeriesHtml = vi.fn(async (payload) => {
      starts.push(payload.requestId)
      if (payload.requestId.endsWith("1")) {
        await new Promise<void>((resolve) => {
          resolveFirstHandler = resolve
        })
      }
      return {
        success: true as const,
        seriesMetadata: { title: "Series" },
        chapterList: { chapters: [], volumes: [] },
      }
    })
    registerOffscreenRuntime(worker, {
      onInitialized,
      onInitializationError,
    })
    const listener = addListener.mock.calls[0]?.[0]
    const firstResponse = vi.fn()
    const secondResponse = vi.fn()

    for (const [requestId, sendResponse] of [
      ["00000000-0000-4000-8000-000000000001", firstResponse],
      ["00000000-0000-4000-8000-000000000002", secondResponse],
    ] as const) {
      expect(
        listener(
          {
            target: "offscreen",
            type: "OFFSCREEN_PARSE_SERIES_HTML",
            payload: {
              requestId,
              siteIntegrationId: "site",
              seriesUrl: "https://example.test/series",
              html: "<html />",
              rateLimitSettings: RATE_LIMIT_SETTINGS,
            },
          },
          backgroundSender,
          sendResponse
        )
      ).toBe(true)
    }

    resolveInitialize()

    await vi.waitFor(() => expect(starts).toHaveLength(2))
    expect(starts).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ])
    await vi.waitFor(() => expect(secondResponse).toHaveBeenCalledOnce())
    expect(firstResponse).not.toHaveBeenCalled()

    resolveFirstHandler()

    await vi.waitFor(() => expect(firstResponse).toHaveBeenCalledOnce())
  })

  it("flushes buffered requests with the initialization failure", async () => {
    let rejectInitialize!: (error: Error) => void
    const worker = createWorker(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectInitialize = reject
        })
    )
    registerOffscreenRuntime(worker, {
      onInitialized,
      onInitializationError,
    })
    const listener = addListener.mock.calls[0]?.[0]
    const responses = [vi.fn(), vi.fn()]
    for (const [index, sendResponse] of responses.entries()) {
      listener(
        {
          target: "offscreen",
          type: "REVOKE_BLOB_URL",
          payload: {
            jobId: `job-${index}`,
            attempt: 1,
            taskId: "task-1",
            chapterId: `chapter-${index}`,
            fingerprint: FINGERPRINT,
            documentInstanceId: DOCUMENT_INSTANCE_ID,
            outputId: `output-${index}`,
            blobUrl: `blob:output-${index}`,
          },
        },
        backgroundSender,
        sendResponse
      )
    }

    rejectInitialize(new Error("bootstrap failed"))

    await vi.waitFor(() => {
      for (const sendResponse of responses) {
        expect(sendResponse).toHaveBeenCalledWith({
          success: false,
          error: "bootstrap failed",
        })
      }
    })
    expect(worker.revokeBlobUrl).not.toHaveBeenCalled()
    expect(onInitializationError).toHaveBeenCalledWith("bootstrap failed")
    expect(sendMessage).toHaveBeenCalledWith({
      target: "background",
      type: "OFFSCREEN_INITIALIZATION_FAILED",
      payload: {
        errorMessage: "bootstrap failed",
        documentInstanceId: DOCUMENT_INSTANCE_ID,
      },
    })

    const statusResponse = vi.fn()
    listener(
      { target: "offscreen", type: "OFFSCREEN_STATUS" },
      backgroundSender,
      statusResponse
    )
    await vi.waitFor(() =>
      expect(statusResponse).toHaveBeenCalledWith({
        success: true,
        initializationState: "failed",
        documentInstanceId: DOCUMENT_INSTANCE_ID,
        activeJobCount: 0,
        activeSeriesResolutionCount: 0,
        activeTaskIds: [],
      })
    )
  })

  it("rejects non-background principals before invoking a handler", async () => {
    const worker = createWorker(async () => undefined)
    registerOffscreenRuntime(worker, {
      onInitialized,
      onInitializationError,
    })
    await vi.waitFor(() => expect(onInitialized).toHaveBeenCalled())
    const listener = addListener.mock.calls[0]?.[0]
    const sendResponse = vi.fn()

    listener(
      { target: "offscreen", type: "OFFSCREEN_STATUS" },
      {
        id: "test-extension",
        url: "chrome-extension://test-extension/sidepanel.html",
        documentId: "sidepanel-document",
      },
      sendResponse
    )

    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: "OFFSCREEN_STATUS is not authorized for sidepanel",
      })
    )
    expect(worker.getActiveJobCount).not.toHaveBeenCalled()
  })
})

describe("createOffscreenRuntimeReadinessController", () => {
  it("keeps control-ready requests outside the initialization queue", async () => {
    const readiness = createOffscreenRuntimeReadinessController()
    await expect(
      readiness.waitForReadiness("control-ready")
    ).resolves.toBeUndefined()
  })
})
