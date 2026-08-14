import { beforeEach, describe, expect, it, vi } from "vitest"

import { handleOffscreenDownloadProgress } from "@/entrypoints/background/offscreen-progress-handler"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
import type { QueueRepository } from "@/src/storage/queue-repository"

type OffscreenDownloadProgressMessage =
  RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_PROGRESS">

const mocks = vi.hoisted(() => ({
  recordOffscreenActivity: vi.fn(async () => undefined),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  renewLease: vi.fn(),
}))

vi.mock("@/entrypoints/background/offscreen-lifecycle", () => ({
  recordOffscreenActivity: mocks.recordOffscreenActivity,
}))

vi.mock("@/src/storage/settings-repository", () => ({
  settingsRepository: {
    getSettings: mocks.getSettings,
    updateSettings: mocks.updateSettings,
  },
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe("offscreen progress cancellation boundary", () => {
  const localSet = vi.fn(async () => undefined)
  const sessionGet = vi.fn(async () => ({}))
  const sessionSet = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSettings.mockResolvedValue({
      downloads: {
        downloadMode: "custom",
        customDirectoryEnabled: true,
      },
    })
    mocks.renewLease.mockResolvedValue({
      outcome: "applied",
      lease: {} as never,
    })
    vi.stubGlobal("chrome", {
      storage: {
        local: { set: localSet },
        session: { get: sessionGet, set: sessionSet },
      },
    })
  })

  it("ignores late progress and destination side effects for a cancelled task", async () => {
    const updateChapterProgress = vi.fn()
    const stateManager = {
      getTask: vi.fn(async () => ({
        id: "task-1",
        status: "canceled",
        chapters: [
          {
            id: "chapter-1",
            url: "https://example.com/chapter-1",
            title: "Chapter 1",
            status: "downloading",
          },
        ],
      })),
      renewDispatchLease: mocks.renewLease,
      updateChapterProgress,
    } as unknown as QueueRepository

    const response = await handleOffscreenDownloadProgress(stateManager, {
      target: "background",
      type: "OFFSCREEN_DOWNLOAD_PROGRESS",
      payload: {
        jobId: "job-1",
        attempt: 1,
        taskId: "task-1",
        chapterId: "chapter-1",
        fingerprint: "a".repeat(64),
        documentInstanceId: "document-1",
        sequence: 1,
        stage: "saving",
        status: "completed",
        outputsRequested: 0,
        outputsFailedBeforeHandoff: 0,
        outputsCommitted: 0,
      },
    } as OffscreenDownloadProgressMessage)

    expect(response).toEqual({
      success: true,
      disposition: "lease_not_current",
    })
    expect(mocks.getSettings).not.toHaveBeenCalled()
    expect(mocks.updateSettings).not.toHaveBeenCalled()
    expect(localSet).not.toHaveBeenCalled()
    expect(sessionGet).not.toHaveBeenCalled()
    expect(sessionSet).not.toHaveBeenCalled()
    expect(updateChapterProgress).not.toHaveBeenCalled()
  })

  it("loses the atomic chapter-update race to cancellation without applying side effects", async () => {
    const updateChapterProgress = vi.fn(async () => ({
      outcome: "rejected" as const,
      reason: "task-not-active" as const,
      currentStatus: "canceled" as const,
    }))
    const stateManager = {
      getTask: vi.fn(async () => ({
        id: "task-1",
        status: "downloading",
        chapters: [
          {
            id: "chapter-1",
            url: "https://example.com/chapter-1",
            title: "Chapter 1",
            status: "downloading",
          },
        ],
      })),
      renewDispatchLease: mocks.renewLease,
      updateChapterProgress,
    } as unknown as QueueRepository

    const response = await handleOffscreenDownloadProgress(stateManager, {
      target: "background",
      type: "OFFSCREEN_DOWNLOAD_PROGRESS",
      payload: {
        jobId: "job-1",
        attempt: 1,
        taskId: "task-1",
        chapterId: "chapter-1",
        fingerprint: "a".repeat(64),
        documentInstanceId: "document-1",
        sequence: 1,
        stage: "saving",
        status: "completed",
        outputsRequested: 0,
        outputsFailedBeforeHandoff: 0,
        outputsCommitted: 0,
      },
    })

    expect(response).toEqual({
      success: true,
      disposition: "lease_not_current",
    })
    expect(updateChapterProgress).toHaveBeenCalledTimes(1)
    expect(mocks.getSettings).not.toHaveBeenCalled()
    expect(localSet).not.toHaveBeenCalled()
    expect(sessionGet).not.toHaveBeenCalled()
    expect(sessionSet).not.toHaveBeenCalled()
  })
})
