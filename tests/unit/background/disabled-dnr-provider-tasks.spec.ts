import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import type { DownloadTaskState } from "@/src/types/queue-state"

const mocks = vi.hoisted(() => ({
  getLease: vi.fn(),
  clearLease: vi.fn(async () => true),
  notifyTerminalTask: vi.fn(async () => undefined),
}))

vi.mock("@/src/runtime/active-dispatch-lease", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/src/runtime/active-dispatch-lease")>()
  return {
    ...actual,
    activeDispatchLeaseStore: {
      ...actual.activeDispatchLeaseStore,
      get: mocks.getLease,
      clear: mocks.clearLease,
    },
  }
})

vi.mock("@/entrypoints/background/download-queue-finalization", () => ({
  notifyTerminalDownloadTask: mocks.notifyTerminalTask,
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

import { failDisabledDnrProviderTasks } from "@/entrypoints/background/download-queue-runner"

function createTask(
  id: string,
  siteIntegrationId: string,
  overrides: Partial<DownloadTaskState> = {}
): DownloadTaskState {
  return {
    id,
    siteIntegrationId,
    mangaId: `${siteIntegrationId}:series`,
    seriesTitle: "Series",
    chapters: [
      {
        id: "chapter-1",
        url: "https://example.test/chapter-1",
        title: "Chapter 1",
        index: 1,
        status: "downloading",
        lastUpdated: 100,
      },
    ],
    status: "downloading",
    created: 100,
    settingsSnapshot: {} as DownloadTaskState["settingsSnapshot"],
    ...overrides,
  }
}

describe("disabled DNR provider task policy", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mocks.getLease.mockResolvedValue({
      jobId: "job-1",
      attempt: 1,
      taskId: "pixiv-task",
      chapterId: "chapter-1",
    })
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ success: true })),
      },
      storage: {
        session: {
          set: vi.fn(async () => undefined),
        },
      },
    } as unknown as typeof chrome)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("fails an active disabled DNR provider and cancels its lease", async () => {
    const pixivTask = createTask("pixiv-task", "pixiv-comic")
    const unaffectedTask = createTask("mangadex-task", "mangadex")
    const queue = [pixivTask, unaffectedTask]
    const transitionDownloadTask = vi.fn(
      async (
        taskId: string,
        _allowed: readonly string[],
        updates: Partial<DownloadTaskState>
      ) => {
        const task = queue.find((candidate) => candidate.id === taskId)
        if (!task) {
          return { success: false as const, reason: "not-found" as const }
        }
        Object.assign(task, updates)
        return { success: true as const, task }
      }
    )
    const stateManager = {
      getGlobalState: vi.fn(async () => ({ downloadQueue: queue })),
      transitionDownloadTask,
    } as unknown as CentralizedStateManager

    await failDisabledDnrProviderTasks(
      stateManager,
      { "pixiv-comic": false, mangadex: false },
      vi.fn(async () => undefined)
    )

    expect(transitionDownloadTask).toHaveBeenCalledTimes(1)
    expect(pixivTask).toMatchObject({
      status: "failed",
      activeBlock: undefined,
      errorMessage: "Integration disabled",
      completed: expect.any(Number),
    })
    expect(unaffectedTask.status).toBe("downloading")
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "OFFSCREEN_CANCEL_JOB",
        payload: expect.objectContaining({ taskId: "pixiv-task" }),
      })
    )
    expect(mocks.clearLease).toHaveBeenCalledWith({
      jobId: "job-1",
      attempt: 1,
    })
    expect(mocks.notifyTerminalTask).toHaveBeenCalledTimes(1)
  })

  it("does not interrupt a task already handed to Chrome Downloads", async () => {
    const pixivTask = createTask("pixiv-task", "pixiv-comic", {
      browserDownloadWait: {
        downloadIds: [42],
        since: 100,
      },
    })
    const transitionDownloadTask = vi.fn()
    const stateManager = {
      getGlobalState: vi.fn(async () => ({ downloadQueue: [pixivTask] })),
      transitionDownloadTask,
    } as unknown as CentralizedStateManager

    await failDisabledDnrProviderTasks(
      stateManager,
      { "pixiv-comic": false },
      vi.fn(async () => undefined)
    )

    expect(transitionDownloadTask).not.toHaveBeenCalled()
    expect(mocks.clearLease).not.toHaveBeenCalled()
  })
})
