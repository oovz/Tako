import { beforeEach, describe, expect, it, vi } from "vitest"

import { dispatchOffscreenChapterWithRecovery } from "@/entrypoints/background/download-queue-runner"
import type { OffscreenDownloadChapterMessage } from "@/src/types/offscreen-messages"

const mocks = vi.hoisted(() => ({
  queryOffscreenJob: vi.fn(),
}))

vi.mock("@/entrypoints/background/offscreen-lifecycle", () => ({
  queryOffscreenJob: mocks.queryOffscreenJob,
  recordOffscreenActivity: vi.fn(async () => undefined),
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

function dispatchMessage(): OffscreenDownloadChapterMessage {
  return {
    type: "OFFSCREEN_DOWNLOAD_CHAPTER",
    payload: {
      jobId: "job-1",
      attempt: 1,
      taskId: "task-1",
      seriesKey: "site:series-1",
      book: {
        siteIntegrationId: "site",
        seriesTitle: "Series",
      },
      chapter: {
        id: "chapter-1",
        title: "Chapter 1",
        url: "https://example.test/chapter-1",
        index: 1,
        resolvedPath: "Series/Chapter 1.cbz",
      },
      settingsSnapshot: {
        archiveFormat: "cbz",
        conflictPolicy: "uniquify",
        includeComicInfo: true,
        includeCoverImage: true,
        rateLimitSettings: {
          image: { concurrency: 2, delayMs: 0 },
          chapter: { concurrency: 1, delayMs: 0 },
        },
        retrySettings: { image: 3, chapter: 3 },
      },
      saveMode: "downloads-api",
    },
  }
}

describe("offscreen chapter dispatch recovery", () => {
  const sendMessage = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queryOffscreenJob.mockResolvedValue(null)
    vi.stubGlobal("chrome", {
      runtime: { sendMessage },
    } as unknown as typeof chrome)
  })

  it("reattaches with the identical job envelope after a response channel closes", async () => {
    const message = dispatchMessage()
    const ensureOffscreenReady = vi.fn(async () => undefined)
    const isDispatchStillCurrent = vi.fn(async () => true)
    sendMessage
      .mockRejectedValueOnce(new Error("message channel closed"))
      .mockResolvedValueOnce({ success: true, status: "completed" })

    await expect(
      dispatchOffscreenChapterWithRecovery({
        message,
        ensureOffscreenReady,
        isDispatchStillCurrent,
      })
    ).resolves.toEqual({ success: true, status: "completed" })

    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(sendMessage.mock.calls[0]?.[0]).toBe(message)
    expect(sendMessage.mock.calls[1]?.[0]).toBe(message)
    expect(ensureOffscreenReady).toHaveBeenCalledTimes(1)
  })

  it("recovers a cached terminal outcome without dispatching again", async () => {
    const message = dispatchMessage()
    sendMessage.mockRejectedValueOnce(new Error("message channel closed"))
    mocks.queryOffscreenJob.mockResolvedValueOnce({
      jobId: "job-1",
      attempt: 1,
      taskId: "task-1",
      chapterId: "chapter-1",
      status: "terminal",
      stage: "saving",
      sequence: 8,
      outcome: {
        status: "partial_success",
        imagesFailed: 2,
        outputsRequested: 1,
        outputsFailedBeforeHandoff: 0,
      },
    })

    await expect(
      dispatchOffscreenChapterWithRecovery({
        message,
        ensureOffscreenReady: vi.fn(async () => undefined),
        isDispatchStillCurrent: vi.fn(async () => true),
      })
    ).resolves.toEqual({
      success: true,
      status: "partial_success",
      errorMessage: undefined,
      errorCategory: undefined,
      imagesFailed: 2,
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: undefined,
    })
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it("does not revive a task whose lease is no longer current", async () => {
    const message = dispatchMessage()
    const ensureOffscreenReady = vi.fn(async () => undefined)
    sendMessage.mockRejectedValueOnce(new Error("message channel closed"))

    await expect(
      dispatchOffscreenChapterWithRecovery({
        message,
        ensureOffscreenReady,
        isDispatchStillCurrent: vi.fn(async () => false),
      })
    ).rejects.toThrow("message channel closed")
    expect(ensureOffscreenReady).not.toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it("rechecks the lease after offscreen readiness before replaying the job", async () => {
    const message = dispatchMessage()
    const ensureOffscreenReady = vi.fn(async () => undefined)
    const isDispatchStillCurrent = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    sendMessage.mockRejectedValueOnce(new Error("message channel closed"))

    await expect(
      dispatchOffscreenChapterWithRecovery({
        message,
        ensureOffscreenReady,
        isDispatchStillCurrent,
      })
    ).rejects.toThrow("message channel closed")

    expect(ensureOffscreenReady).toHaveBeenCalledTimes(1)
    expect(isDispatchStillCurrent).toHaveBeenCalledTimes(2)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it("uses a terminal query result when the replacement channel also closes", async () => {
    const message = dispatchMessage()
    sendMessage
      .mockRejectedValueOnce(new Error("first channel closed"))
      .mockRejectedValueOnce(new Error("second channel closed"))
    mocks.queryOffscreenJob.mockResolvedValueOnce(null).mockResolvedValueOnce({
      jobId: "job-1",
      attempt: 1,
      taskId: "task-1",
      chapterId: "chapter-1",
      status: "terminal",
      stage: "saving",
      sequence: 9,
      outcome: {
        status: "completed",
        outputsRequested: 1,
        outputsCommitted: 1,
      },
    })

    await expect(
      dispatchOffscreenChapterWithRecovery({
        message,
        ensureOffscreenReady: vi.fn(async () => undefined),
        isDispatchStillCurrent: vi.fn(async () => true),
      })
    ).resolves.toMatchObject({
      success: true,
      status: "completed",
      outputsRequested: 1,
      outputsCommitted: 1,
    })
    expect(sendMessage).toHaveBeenCalledTimes(2)
  })
})
