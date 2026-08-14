import { beforeEach, describe, expect, it, vi } from "vitest"

import { handleOffscreenDownloadProgress } from "@/entrypoints/background/offscreen-progress-handler"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { DownloadTaskState } from "@/src/domain/queue/state"

type OffscreenDownloadProgressMessage =
  RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_PROGRESS">

const mocks = vi.hoisted(() => ({
  recordOffscreenActivity: vi.fn(async () => undefined),
  getSettings: vi.fn(),
  updateSettings: vi.fn(async () => undefined),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  renewLease: vi.fn(),
  getProgressSnapshot: vi.fn(),
  publishProgress: vi.fn(),
  runProgressExclusive: vi.fn(),
  observeProgressTiming: vi.fn(),
  finishProgressTiming: vi.fn(),
}))

vi.mock("@/entrypoints/background/offscreen-lifecycle", () => ({
  recordOffscreenActivity: mocks.recordOffscreenActivity,
}))

vi.mock("@/entrypoints/background/active-task-progress-bus", () => ({
  getActiveTaskProgressSnapshot: mocks.getProgressSnapshot,
  publishActiveTaskProgress: mocks.publishProgress,
  runActiveTaskProgressExclusive: mocks.runProgressExclusive,
}))

vi.mock("@/src/runtime/progress-timing-estimates", () => ({
  progressTimingEstimator: {
    observe: mocks.observeProgressTiming,
    finish: mocks.finishProgressTiming,
  },
}))

vi.mock("@/src/storage/settings-repository", () => ({
  settingsRepository: {
    getSettings: mocks.getSettings,
    updateSettings: mocks.updateSettings,
  },
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: mocks.debug,
    info: vi.fn(),
    warn: mocks.warn,
    error: mocks.error,
  },
}))

type ChapterFixture = {
  id: string
  url: string
  title: string
  status: string
}

type TaskFixture = {
  id: string
  status: string
  siteIntegrationId: string
  settingsSnapshot: {
    archiveFormat: "cbz"
    destination: "downloads-api" | "file-system-access"
  }
  destinationOverride?: "downloads-api" | "file-system-access"
  chapters: ChapterFixture[]
}

function makeTask(overrides: Partial<TaskFixture> = {}): TaskFixture {
  return {
    id: "task-1",
    status: "downloading",
    siteIntegrationId: "mangadex",
    settingsSnapshot: {
      archiveFormat: "cbz",
      destination: "downloads-api",
    },
    chapters: [
      {
        id: "chapter-1",
        url: "https://example.test/chapter-1",
        title: "Chapter One",
        status: "downloading",
      },
    ],
    ...overrides,
  }
}

function progress(
  overrides: Partial<OffscreenDownloadProgressMessage["payload"]> = {}
): OffscreenDownloadProgressMessage {
  return {
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
      stage: "downloading",
      status: "downloading",
      outputsRequested: 0,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 0,
      ...overrides,
    },
  }
}

function makeStateManager(
  tasks: TaskFixture[] = [makeTask()],
  updateResult?: Awaited<ReturnType<QueueRepository["updateChapterProgress"]>>
) {
  const state = { downloadQueue: tasks }
  const updateChapterProgress = vi.fn(
    async (
      input: Parameters<QueueRepository["updateChapterProgress"]>[0]
    ): ReturnType<QueueRepository["updateChapterProgress"]> => {
      if (updateResult) return updateResult

      const task = state.downloadQueue.find((task) => task.id === input.taskId)
      const chapter = task?.chapters.find(
        (candidate) => candidate.id === input.chapterId
      )
      if (chapter) {
        chapter.status = "downloading"
        Object.assign(chapter, input.updates)
      }
      return {
        outcome: "applied",
        task: task as never,
        chapter: chapter as never,
      }
    }
  )
  const manager = {
    getTask: vi.fn(async (taskId: string) =>
      state.downloadQueue.find((task) => task.id === taskId)
    ),
    renewDispatchLease: mocks.renewLease,
    updateChapterProgress,
  } as unknown as QueueRepository

  return { manager, state, updateChapterProgress }
}

describe("offscreen progress handler behavior", () => {
  const localSet = vi.fn(async (_items: Record<string, unknown>) => undefined)
  const sessionGet = vi.fn(
    async (_keys?: string | string[]) => ({}) as Record<string, unknown>
  )
  const sessionSet = vi.fn(async (_items: Record<string, unknown>) => undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSettings.mockResolvedValue({
      downloads: {
        downloadMode: "custom",
        customDirectoryEnabled: true,
        customDirectoryHandleId: "folder-1",
      },
    })
    mocks.renewLease.mockResolvedValue({
      outcome: "applied",
      lease: {} as never,
    })
    mocks.getProgressSnapshot.mockImplementation(async () => {
      const stored = await sessionGet([
        SESSION_STORAGE_KEYS.activeTaskProgress,
        SESSION_STORAGE_KEYS.activeTaskProgressRevision,
      ])
      return {
        revision: 0,
        progress: stored[SESSION_STORAGE_KEYS.activeTaskProgress] ?? null,
      }
    })
    mocks.publishProgress.mockResolvedValue(null)
    mocks.runProgressExclusive.mockImplementation(
      async (operation: () => Promise<unknown>) => await operation()
    )
    mocks.observeProgressTiming.mockResolvedValue({
      resolving: 800,
      downloading: 8_000,
      transforming: 0,
      archiving: 2_500,
      saving: 1_000,
    })
    mocks.finishProgressTiming.mockResolvedValue(undefined)
    vi.stubGlobal("chrome", {
      storage: {
        local: { set: localSet },
        session: { get: sessionGet, set: sessionSet },
      },
    })
  })

  it("rejects malformed and non-progress-shaped input without side effects", async () => {
    const { manager, updateChapterProgress } = makeStateManager()

    const response = await handleOffscreenDownloadProgress(manager, {
      type: "OFFSCREEN_STATUS",
    } as unknown as OffscreenDownloadProgressMessage)

    expect(response.success).toBe(false)
    if (response.success) {
      throw new Error("Expected malformed progress to be rejected")
    }
    expect(response.error).toBeTruthy()
    expect(mocks.recordOffscreenActivity).not.toHaveBeenCalled()
    expect(updateChapterProgress).not.toHaveBeenCalled()
    expect(sessionSet).not.toHaveBeenCalled()
  })

  it.each([
    [{ chapterId: "chapter-1", status: "completed" }],
    [{ taskId: "task-1", status: "completed" }],
    [{ taskId: "task-1", chapterId: "chapter-1", status: undefined }],
    [{ taskId: "task-1", chapterId: "chapter-1", status: "waiting" }],
  ])("rejects missing or unsupported progress identity %#", async (payload) => {
    const { manager, updateChapterProgress } = makeStateManager()

    const response = await handleOffscreenDownloadProgress(manager, {
      type: "OFFSCREEN_DOWNLOAD_PROGRESS",
      payload,
    } as unknown as OffscreenDownloadProgressMessage)

    expect(response).toEqual({
      success: false,
      error:
        "Missing job, task, chapter, sequence, stage, or status in OFFSCREEN_DOWNLOAD_PROGRESS",
    })
    expect(mocks.recordOffscreenActivity).not.toHaveBeenCalled()
    expect(updateChapterProgress).not.toHaveBeenCalled()
  })

  it.each([
    ["unknown task", [], "task-1", "chapter-1"],
    [
      "inactive parent",
      [makeTask({ status: "canceled" })],
      "task-1",
      "chapter-1",
    ],
    ["unknown chapter", [makeTask()], "task-1", "missing-chapter"],
  ])(
    "acknowledges and ignores %s races",
    async (_label, tasks, taskId, chapterId) => {
      const { manager, updateChapterProgress } = makeStateManager(tasks)

      const response = await handleOffscreenDownloadProgress(
        manager,
        progress({ taskId, chapterId, status: "completed" })
      )
      expect(response).toEqual({
        success: true,
        disposition:
          _label === "unknown chapter" ? "protocol_error" : "lease_not_current",
      })
      expect(updateChapterProgress).not.toHaveBeenCalled()
      expect(mocks.getSettings).not.toHaveBeenCalled()
      expect(sessionGet).not.toHaveBeenCalled()
      expect(sessionSet).not.toHaveBeenCalled()
    }
  )

  it("keeps native output handoff visible at saving until Chrome commits it", async () => {
    const { manager } = makeStateManager()

    await handleOffscreenDownloadProgress(
      manager,
      progress({
        status: "completed",
        stage: "saving",
        phaseFraction: 0.99,
        totalImages: 4,
        imagesProcessed: 4,
        outputsRequested: 1,
        outputsCommitted: 0,
      })
    )

    expect(mocks.publishProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "saving",
        phaseFraction: 0.99,
        outputCommitted: false,
        overallFraction: expect.any(Number),
      }),
      { forcePersist: true }
    )
    expect(mocks.publishProgress).not.toHaveBeenCalledWith(
      null,
      expect.anything()
    )
    expect(mocks.finishProgressTiming).not.toHaveBeenCalled()
  })

  it("publishes an FSA commit before the runner settles the chapter", async () => {
    const { manager } = makeStateManager([
      makeTask({
        settingsSnapshot: {
          archiveFormat: "cbz",
          destination: "file-system-access",
        },
      }),
    ])

    await handleOffscreenDownloadProgress(
      manager,
      progress({
        status: "completed",
        stage: "saving",
        phaseFraction: 1,
        outputsRequested: 1,
        outputsCommitted: 1,
      })
    )

    expect(mocks.publishProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "saving",
        phaseFraction: 1,
        outputCommitted: true,
      }),
      { forcePersist: true }
    )
    expect(mocks.finishProgressTiming).toHaveBeenCalledWith("job-1")
  })

  it("finishes an FSA timing sample when the terminal write is incomplete", async () => {
    const { manager } = makeStateManager([
      makeTask({
        settingsSnapshot: {
          archiveFormat: "cbz",
          destination: "file-system-access",
        },
      }),
    ])

    await handleOffscreenDownloadProgress(
      manager,
      progress({
        status: "failed",
        stage: "saving",
        phaseFraction: 0.7,
        outputsRequested: 1,
        outputsCommitted: 0,
        errorCategory: "folder_write_failed",
      })
    )

    expect(mocks.finishProgressTiming).toHaveBeenCalledWith("job-1")
  })

  it("stops before destination side effects when atomic update rejects", async () => {
    const { manager, updateChapterProgress } = makeStateManager([makeTask()], {
      outcome: "rejected",
      reason: "task-not-active",
      currentStatus: "canceled",
    })

    await expect(
      handleOffscreenDownloadProgress(
        manager,
        progress({
          status: "failed",
          errorCategory: "folder_permission_required",
        })
      )
    ).resolves.toEqual({ success: true, disposition: "lease_not_current" })

    expect(updateChapterProgress).toHaveBeenCalledTimes(1)
    expect(mocks.getSettings).not.toHaveBeenCalled()
    expect(localSet).not.toHaveBeenCalled()
    expect(sessionGet).not.toHaveBeenCalled()
  })

  it("projects normalized downloading progress and canonical chapter identity", async () => {
    vi.spyOn(Date, "now").mockReturnValue(12345)
    const task = makeTask({
      chapters: [
        {
          id: "canonical-1",
          url: "https://example.test/chapter-1",
          title: "Stable title",
          status: "downloading",
        },
      ],
    })
    const { manager, updateChapterProgress } = makeStateManager([task])

    const response = await handleOffscreenDownloadProgress(
      manager,
      progress({
        chapterId: "canonical-1",
        chapterTitle: "  Payload title  ",
        imagesProcessed: -3,
        totalImages: 7,
        imagesFailed: 2,
        error: "ignored while downloading",
      })
    )

    expect(response).toEqual({ success: true, disposition: "renewed" })
    expect(updateChapterProgress).toHaveBeenCalledWith({
      taskId: "task-1",
      chapterId: "canonical-1",
      lease: {
        jobId: "job-1",
        attempt: 1,
        taskId: "task-1",
        chapterId: "canonical-1",
        fingerprint: "a".repeat(64),
        documentInstanceId: "document-1",
      },
      now: 12345,
      updates: {
        totalImages: 7,
        imagesFailed: 2,
        errorMessage: undefined,
        errorCategory: undefined,
      },
    })
    expect(mocks.publishProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        chapterId: "canonical-1",
        chapterTitle: "Payload title",
        activeChapterCount: 1,
        activeChapters: [
          {
            chapterId: "canonical-1",
            chapterTitle: "Payload title",
            imagesProcessed: 0,
            totalImages: 7,
            stage: "downloading",
            phaseFraction: 0,
            updatedAt: 12345,
          },
        ],
        imagesProcessed: 0,
        totalImages: 7,
        stage: "downloading",
        phaseFraction: 0,
        outputCommitted: false,
        status: "downloading",
      }),
      { forcePersist: false }
    )
  })

  it("keeps progress identities exact and prunes inactive chapters", async () => {
    sessionGet.mockResolvedValueOnce({
      [SESSION_STORAGE_KEYS.activeTaskProgress]: {
        taskId: "task-1",
        activeChapters: [
          null,
          { chapterId: "", imagesProcessed: 99 },
          {
            chapterId: "chapter-1",
            chapterTitle: "Older exact snapshot",
            imagesProcessed: 3,
            totalImages: 8,
            updatedAt: 8,
          },
          {
            chapterId: "chapter-1",
            chapterTitle: "  ",
            imagesProcessed: 4,
            totalImages: 10,
            updatedAt: 10,
          },
          {
            chapterId: "chapter-2",
            chapterTitle: "Second",
            imagesProcessed: 5,
            totalImages: 9,
            updatedAt: 9,
          },
          {
            chapterId: "not-active",
            imagesProcessed: 100,
            totalImages: 100,
            updatedAt: 9,
          },
        ],
      },
    })
    const { manager } = makeStateManager([
      makeTask({
        chapters: [
          {
            id: "chapter-1",
            url: "https://example.test/chapter-1",
            title: "First",
            status: "downloading",
          },
          {
            id: "chapter-2",
            url: "https://example.test/chapter-2",
            title: "Second",
            status: "downloading",
          },
        ],
      }),
    ])

    await handleOffscreenDownloadProgress(
      manager,
      progress({ imagesProcessed: 6, totalImages: undefined })
    )

    const written = mocks.publishProgress.mock.calls[0]?.[0]
    if (!written || typeof written !== "object") {
      throw new Error("Expected active progress projection")
    }
    expect(written).toMatchObject({
      activeChapterCount: 2,
      imagesProcessed: 11,
      totalImages: 19,
      chapterId: "chapter-1",
      chapterTitle: "First",
    })
    expect((written as { activeChapters?: unknown }).activeChapters).toEqual([
      expect.objectContaining({
        chapterId: "chapter-1",
        chapterTitle: "First",
        imagesProcessed: 6,
        totalImages: 10,
      }),
      expect.objectContaining({
        chapterId: "chapter-2",
        chapterTitle: "Second",
        imagesProcessed: 5,
        totalImages: 9,
      }),
    ])
  })

  it("rejects a chapter URL in place of the canonical chapter ID without mutation", async () => {
    const { manager, updateChapterProgress } = makeStateManager()
    mocks.renewLease.mockResolvedValueOnce({
      outcome: "rejected",
      reason: "lease-not-current",
    })

    const response = await handleOffscreenDownloadProgress(
      manager,
      progress({ chapterId: "https://example.test/chapter-1" })
    )

    expect(response).toEqual({
      success: true,
      disposition: "lease_not_current",
    })
    expect(updateChapterProgress).not.toHaveBeenCalled()
    expect(mocks.getProgressSnapshot).not.toHaveBeenCalled()
    expect(mocks.publishProgress).not.toHaveBeenCalled()
  })

  it("rejects delayed progress from a prior attempt before publishing the current retry", async () => {
    sessionGet.mockResolvedValue({
      [SESSION_STORAGE_KEYS.activeTaskProgress]: {
        taskId: "task-1",
        activeChapters: [
          {
            chapterId: "chapter-1",
            chapterTitle: "Prior attempt",
            imagesProcessed: 9,
            totalImages: 10,
            stage: "downloading",
            phaseFraction: 0.9,
            updatedAt: 1,
          },
        ],
      },
    })
    const { manager, updateChapterProgress } = makeStateManager()
    mocks.renewLease
      .mockResolvedValueOnce({
        outcome: "rejected",
        reason: "lease-not-current",
      })
      .mockResolvedValueOnce({
        outcome: "applied",
        lease: {} as never,
      })

    const delayedResponse = await handleOffscreenDownloadProgress(
      manager,
      progress({
        jobId: "job-prior",
        attempt: 1,
        sequence: 20,
        imagesProcessed: 10,
        totalImages: 10,
      })
    )
    const currentResponse = await handleOffscreenDownloadProgress(
      manager,
      progress({
        jobId: "job-current",
        attempt: 2,
        sequence: 1,
        imagesProcessed: 1,
        totalImages: 10,
      })
    )

    expect(delayedResponse).toEqual({
      success: true,
      disposition: "lease_not_current",
    })
    expect(currentResponse).toEqual({
      success: true,
      disposition: "renewed",
    })
    expect(updateChapterProgress).toHaveBeenCalledTimes(1)
    expect(updateChapterProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        lease: expect.objectContaining({
          jobId: "job-current",
          attempt: 2,
          taskId: "task-1",
          chapterId: "chapter-1",
        }),
      })
    )
    expect(mocks.publishProgress).toHaveBeenCalledTimes(1)
    expect(mocks.publishProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        chapterId: "chapter-1",
        imagesProcessed: 1,
        totalImages: 10,
        activeChapters: [
          expect.objectContaining({
            chapterId: "chapter-1",
            imagesProcessed: 1,
            totalImages: 10,
          }),
        ],
      }),
      { forcePersist: false }
    )
  })

  it.each([
    ["completed", undefined],
    ["failed", "network failure"],
    ["partial_success", "two images failed"],
  ] as const)(
    "retains terminal %s progress until runner finalization",
    async (status, error) => {
      sessionGet.mockResolvedValueOnce({
        [SESSION_STORAGE_KEYS.activeTaskProgress]: {
          taskId: "task-1",
          activeChapters: [
            {
              chapterId: "chapter-1",
              imagesProcessed: 4,
              totalImages: 4,
              updatedAt: 1,
            },
          ],
        },
      })
      const { manager, updateChapterProgress } = makeStateManager()

      await handleOffscreenDownloadProgress(
        manager,
        progress({ status, error, totalImages: 4, imagesFailed: 2 })
      )

      expect(updateChapterProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-1",
          chapterId: "chapter-1",
          lease: {
            jobId: "job-1",
            attempt: 1,
            taskId: "task-1",
            chapterId: "chapter-1",
            fingerprint: "a".repeat(64),
            documentInstanceId: "document-1",
          },
          updates: {
            totalImages: 4,
            imagesFailed: 2,
            errorMessage: status === "completed" ? undefined : error,
            errorCategory: status === "completed" ? undefined : "unknown",
          },
        })
      )
      expect(mocks.publishProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: "saving",
          phaseFraction: 0.99,
          outputCommitted: false,
        }),
        { forcePersist: true }
      )
    }
  )

  it("removes stale downloading projection for an already-terminal chapter", async () => {
    const task = makeTask()
    task.chapters[0]!.status = "completed"
    sessionGet.mockResolvedValueOnce({
      [SESSION_STORAGE_KEYS.activeTaskProgress]: {
        taskId: "task-1",
        activeChapters: [
          {
            chapterId: "chapter-1",
            imagesProcessed: 2,
            totalImages: 4,
            updatedAt: 1,
          },
        ],
      },
    })
    const { manager } = makeStateManager([task], {
      outcome: "unchanged",
      reason: "terminal-chapter",
    })

    await handleOffscreenDownloadProgress(
      manager,
      progress({ imagesProcessed: 3 })
    )

    expect(mocks.publishProgress).toHaveBeenCalledWith(null, {
      forcePersist: true,
    })
  })

  it("leaves destination issue creation to the authoritative queue runner", async () => {
    const { manager } = makeStateManager()

    await handleOffscreenDownloadProgress(
      manager,
      progress({
        status: "failed",
        errorCategory: "folder_unavailable",
      })
    )

    expect(mocks.updateSettings).not.toHaveBeenCalled()
    expect(localSet).not.toHaveBeenCalled()
  })

  it.each([
    [
      "state read",
      (manager: QueueRepository) => {
        vi.mocked(manager.getTask).mockRejectedValueOnce(
          new Error("state read failed")
        )
      },
    ],
    [
      "atomic chapter update",
      (manager: QueueRepository) => {
        vi.mocked(manager.updateChapterProgress).mockRejectedValueOnce(
          new Error("chapter update failed")
        )
      },
    ],
  ])(
    "reports %s exceptions without storage projection",
    async (_label, fail) => {
      const { manager } = makeStateManager()
      fail(manager)

      const response = await handleOffscreenDownloadProgress(
        manager,
        progress({ totalImages: 5 })
      )

      expect(response.success).toBe(false)
      if (response.success) {
        throw new Error(`Expected ${_label} failure`)
      }
      expect(response.error).toMatch(/failed/)
      expect(sessionGet).not.toHaveBeenCalled()
    }
  )

  it.each([
    [
      "progress snapshot",
      () =>
        mocks.getProgressSnapshot.mockRejectedValueOnce(
          new Error("progress snapshot failed")
        ),
    ],
    [
      "progress publication",
      () =>
        mocks.publishProgress.mockRejectedValueOnce(
          new Error("progress publication failed")
        ),
    ],
  ])(
    "reports %s failures through the response contract",
    async (_label, fail) => {
      fail()
      const { manager } = makeStateManager()

      const response = await handleOffscreenDownloadProgress(
        manager,
        progress()
      )

      expect(response.success).toBe(false)
      if (response.success) {
        throw new Error(`Expected ${_label} failure`)
      }
      expect(response.error).toBeTruthy()
      expect(mocks.error).toHaveBeenCalledTimes(1)
    }
  )

  it("does not emit notifications for intermediate or terminal progress messages", async () => {
    const notificationsCreate = vi.fn()
    ;(
      chrome as unknown as {
        notifications: { create: typeof notificationsCreate }
      }
    ).notifications = { create: notificationsCreate }
    const { manager } = makeStateManager()

    await handleOffscreenDownloadProgress(manager, progress())
    await handleOffscreenDownloadProgress(
      manager,
      progress({ status: "completed" })
    )

    expect(notificationsCreate).not.toHaveBeenCalled()
  })

  it("serializes overlapping progress handlers before renewing their sequence", async () => {
    const { manager, state } = makeStateManager()
    const task = state.downloadQueue[0] as unknown as DownloadTaskState
    let releaseFirstRead!: () => void
    vi.mocked(manager.getTask)
      .mockImplementationOnce(
        async () =>
          await new Promise((resolve) => {
            releaseFirstRead = () => resolve(task)
          })
      )
      .mockImplementation(async () => task)

    const first = handleOffscreenDownloadProgress(
      manager,
      progress({ sequence: 1, imagesProcessed: 1, totalImages: 10 })
    )
    await vi.waitFor(() => expect(mocks.renewLease).toHaveBeenCalledTimes(1))
    const second = handleOffscreenDownloadProgress(
      manager,
      progress({ sequence: 2, imagesProcessed: 2, totalImages: 10 })
    )
    await Promise.resolve()
    expect(mocks.renewLease).toHaveBeenCalledTimes(1)

    releaseFirstRead()
    await Promise.all([first, second])

    expect(
      mocks.renewLease.mock.calls.map(([input]) => input.sequence)
    ).toEqual([1, 2])
    expect(
      mocks.publishProgress.mock.calls.map(([snapshot]) =>
        snapshot ? snapshot.imagesProcessed : null
      )
    ).toEqual([1, 2])
  })
})
