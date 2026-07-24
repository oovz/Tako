import { beforeEach, describe, expect, it, vi } from "vitest"

import { handleOffscreenDownloadProgress } from "@/entrypoints/background/offscreen-progress-handler"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import type { OffscreenDownloadProgressMessage } from "@/src/types/offscreen-messages"

const mocks = vi.hoisted(() => ({
  recordOffscreenActivity: vi.fn(async () => undefined),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  renewLease: vi.fn(),
}))

vi.mock("@/entrypoints/background/offscreen-lifecycle", () => ({
  recordOffscreenActivity: mocks.recordOffscreenActivity,
}))

vi.mock("@/src/runtime/active-dispatch-lease", () => ({
  activeDispatchLeaseStore: { renew: mocks.renewLease },
}))

vi.mock("@/src/storage/settings-service", () => ({
  settingsService: {
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
    mocks.renewLease.mockResolvedValue(true)
    vi.stubGlobal("chrome", {
      storage: {
        local: { set: localSet },
        session: { get: sessionGet, set: sessionSet },
      },
    })
  })

  it("ignores late progress and destination side effects for a cancelled task", async () => {
    const updateDownloadTaskChapter = vi.fn()
    const stateManager = {
      getGlobalState: vi.fn(async () => ({
        downloadQueue: [
          {
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
          },
        ],
      })),
      updateDownloadTaskChapter,
    } as unknown as CentralizedStateManager

    const response = await handleOffscreenDownloadProgress(stateManager, {
      type: "OFFSCREEN_DOWNLOAD_PROGRESS",
      payload: {
        jobId: "job-1",
        attempt: 1,
        taskId: "task-1",
        chapterId: "chapter-1",
        sequence: 1,
        stage: "saving",
        status: "completed",
      },
    } as OffscreenDownloadProgressMessage)

    expect(response).toEqual({ success: true })
    expect(mocks.getSettings).not.toHaveBeenCalled()
    expect(mocks.updateSettings).not.toHaveBeenCalled()
    expect(localSet).not.toHaveBeenCalled()
    expect(sessionGet).not.toHaveBeenCalled()
    expect(sessionSet).not.toHaveBeenCalled()
    expect(updateDownloadTaskChapter).not.toHaveBeenCalled()
  })

  it("loses the atomic chapter-update race to cancellation without applying side effects", async () => {
    const updateDownloadingTaskChapter = vi.fn(async () => ({
      success: false as const,
      reason: "task-not-downloading" as const,
      currentStatus: "canceled" as const,
    }))
    const stateManager = {
      getGlobalState: vi.fn(async () => ({
        downloadQueue: [
          {
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
          },
        ],
      })),
      updateDownloadingTaskChapter,
    } as unknown as CentralizedStateManager

    const response = await handleOffscreenDownloadProgress(stateManager, {
      type: "OFFSCREEN_DOWNLOAD_PROGRESS",
      payload: {
        jobId: "job-1",
        attempt: 1,
        taskId: "task-1",
        chapterId: "chapter-1",
        sequence: 1,
        stage: "saving",
        status: "completed",
      },
    })

    expect(response).toEqual({ success: true })
    expect(updateDownloadingTaskChapter).toHaveBeenCalledTimes(1)
    expect(mocks.getSettings).not.toHaveBeenCalled()
    expect(localSet).not.toHaveBeenCalled()
    expect(sessionGet).not.toHaveBeenCalled()
    expect(sessionSet).not.toHaveBeenCalled()
  })
})
