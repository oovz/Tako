import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { OffscreenWorker } from "@/entrypoints/offscreen/main-worker"
import { registerOffscreenRuntime } from "@/entrypoints/offscreen/runtime-bridge"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createOffscreenDispatchFingerprint } from "@/src/runtime/offscreen-job-fingerprint"
import type { OffscreenJobIncarnation } from "@/src/runtime/offscreen-job-contracts"
import type {
  RuntimeMessage,
  RuntimeMessageRequest,
} from "@/src/runtime/runtime-message-contracts"
import type { RuntimeMessageListener } from "@/src/runtime/runtime-message-dispatcher"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const EXTENSION_ID = "test-extension"
const DOCUMENT_ID = "offscreen-document-1"

async function dispatchRequest(): Promise<
  RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_CHAPTER">
> {
  const payload: Omit<
    RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_CHAPTER">["payload"],
    "fingerprint"
  > = {
    jobId: "job-1",
    attempt: 1,
    taskId: "task-1",
    seriesKey: "mycomic:123",
    book: { siteIntegrationId: "mycomic", seriesTitle: "Series" },
    chapter: {
      id: "456",
      title: "Chapter 1",
      url: "https://mycomic.com/chapters/456/",
      index: 1,
      resolvedPath: "Series/Chapter 1",
    },
    settingsSnapshot: {
      ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "mycomic"),
      archiveFormat: "none",
      includeComicInfo: false,
      includeCoverImage: false,
      rateLimitSettings: {
        image: { concurrency: 1, delayMs: 0 },
        chapter: { concurrency: 1, delayMs: 0 },
      },
      retrySettings: { image: 0, chapter: 0 },
    },
    saveMode: "downloads-api",
  }
  return {
    target: "offscreen",
    type: "OFFSCREEN_DOWNLOAD_CHAPTER",
    payload: {
      ...payload,
      fingerprint: await createOffscreenDispatchFingerprint(payload),
    },
  }
}

describe("registered offscreen worker controls", () => {
  let listener: RuntimeMessageListener | undefined
  let ready: ReturnType<typeof Promise.withResolvers<void>>
  let fetchStarted: ReturnType<typeof Promise.withResolvers<void>>
  let fetchAborted: ReturnType<typeof Promise.withResolvers<void>>
  const admitted: OffscreenJobIncarnation[] = []
  const fetcher = vi.fn<typeof fetch>()

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-30T12:00:00Z"))
    listener = undefined
    admitted.length = 0
    ready = Promise.withResolvers<void>()
    fetchStarted = Promise.withResolvers<void>()
    fetchAborted = Promise.withResolvers<void>()
    fetcher.mockReset().mockImplementation(async (_input, init) => {
      const signal = init?.signal
      if (!signal) throw new Error("Provider request requires cancellation")
      fetchStarted.resolve()
      return await new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          fetchAborted.resolve()
          reject(signal.reason)
        }
        signal.addEventListener("abort", abort, { once: true })
        if (signal.aborted) abort()
      })
    })
    vi.stubGlobal("fetch", fetcher)
    vi.stubGlobal("chrome", {
      runtime: {
        id: EXTENSION_ID,
        onMessage: {
          addListener: (registered: RuntimeMessageListener) => {
            listener = registered
          },
        },
        sendMessage: async (message: RuntimeMessage): Promise<unknown> => {
          if (message.target === "offscreen") {
            return await new Promise((resolve, reject) => {
              if (!listener?.(message, { id: EXTENSION_ID }, resolve)) {
                reject(new Error("Offscreen listener did not claim request"))
              }
            })
          }
          if (message.type === "GET_SITE_INTEGRATION_ENABLEMENT") {
            return { success: true, enablement: { mycomic: true } }
          }
          if (
            message.type === "OFFSCREEN_JOB_ACCEPTED" ||
            message.type === "OFFSCREEN_JOB_HEARTBEAT" ||
            message.type === "OFFSCREEN_DOWNLOAD_PROGRESS" ||
            message.type === "OFFSCREEN_JOB_TERMINAL"
          ) {
            return { success: true, disposition: "renewed" }
          }
          throw new Error(`Unexpected background request: ${message.type}`)
        },
      },
    })
    registerOffscreenRuntime(new OffscreenWorker(DOCUMENT_ID), {
      onInitialized: () => ready.resolve(),
      onInitializationError: (message) => ready.reject(new Error(message)),
    })
    await ready.promise
  })

  afterEach(async () => {
    try {
      for (const identity of admitted) {
        await sendRuntimeMessage({
          target: "offscreen",
          type: "OFFSCREEN_CANCEL_JOB",
          payload: identity,
        })
      }
      await vi.advanceTimersByTimeAsync(100)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it("reports absent work without claiming that an existing producer was canceled", async () => {
    const identity: OffscreenJobIncarnation = {
      jobId: "absent-job",
      attempt: 1,
      taskId: "absent-task",
      chapterId: "absent-chapter",
      fingerprint: "a".repeat(64),
      documentInstanceId: DOCUMENT_ID,
    }
    const requestId = crypto.randomUUID()
    await expect(
      sendRuntimeMessage({
        target: "offscreen",
        type: "OFFSCREEN_QUERY_JOB",
        payload: { requestId, identity },
      })
    ).resolves.toEqual({ success: true, requestId, job: null })
    await expect(
      sendRuntimeMessage({
        target: "offscreen",
        type: "OFFSCREEN_CANCEL_JOB",
        payload: identity,
      })
    ).resolves.toMatchObject({
      success: true,
      ...identity,
      canceled: false,
      status: "absent",
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("keeps running ownership exact and confirms repeated cooperative cancellation", async () => {
    const request = await dispatchRequest()
    const acknowledgment = await sendRuntimeMessage(request)
    expect(acknowledgment.success).toBe(true)
    if (!acknowledgment.success) throw new Error(acknowledgment.error)
    const { accepted, success, ...identity } = acknowledgment
    expect(accepted).toBe(true)
    expect(success).toBe(true)
    admitted.push(identity)
    await vi.advanceTimersByTimeAsync(50)
    await fetchStarted.promise
    expect(fetcher).toHaveBeenCalledOnce()

    await expect(
      sendRuntimeMessage({ target: "offscreen", type: "OFFSCREEN_STATUS" })
    ).resolves.toMatchObject({
      success: true,
      initializationState: "ready",
      documentInstanceId: DOCUMENT_ID,
      activeJobCount: 1,
      activeTaskIds: [request.payload.taskId],
    })
    await expect(
      sendRuntimeMessage({
        target: "offscreen",
        type: "OFFSCREEN_QUERY_JOB",
        payload: { requestId: crypto.randomUUID(), identity },
      })
    ).resolves.toMatchObject({
      success: true,
      job: { ...identity, status: "active", stage: "resolving" },
    })
    await expect(
      sendRuntimeMessage({
        target: "offscreen",
        type: "OFFSCREEN_QUERY_JOB",
        payload: {
          requestId: crypto.randomUUID(),
          identity: { ...identity, documentInstanceId: "previous-document" },
        },
      })
    ).resolves.toMatchObject({ success: true, job: null })

    const cancellation = {
      target: "offscreen",
      type: "OFFSCREEN_CANCEL_JOB",
      payload: identity,
    } as const
    await expect(sendRuntimeMessage(cancellation)).resolves.toMatchObject({
      success: true,
      ...identity,
      canceled: true,
      status: "canceled",
    })
    await fetchAborted.promise
    await vi.advanceTimersByTimeAsync(100)
    await expect(sendRuntimeMessage(cancellation)).resolves.toMatchObject({
      success: true,
      ...identity,
      canceled: true,
      status: "canceled",
    })
    await expect(
      sendRuntimeMessage({ target: "offscreen", type: "OFFSCREEN_STATUS" })
    ).resolves.toMatchObject({
      success: true,
      activeJobCount: 0,
      activeTaskIds: [],
    })
    await expect(
      sendRuntimeMessage({
        target: "offscreen",
        type: "OFFSCREEN_QUERY_JOB",
        payload: { requestId: crypto.randomUUID(), identity },
      })
    ).resolves.toMatchObject({
      success: true,
      job: { ...identity, status: "canceled" },
    })
  })
})
