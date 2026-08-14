import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { QueueRepository } from "@/src/storage/queue-repository"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import { DownloadTaskCancellationCoordinator } from "@/entrypoints/background/download-task-cancellation-coordinator"
import { ProviderPolicyQueueCoordinator } from "@/entrypoints/background/provider-policy-queue-coordinator"
import type { DestinationService } from "@/entrypoints/background/destination"
import type { DownloadQueueFinalizationDependencies } from "@/entrypoints/background/download-queue-finalization"
import type { SiteIntegrationEnablementMap } from "@/src/domain/site-integrations/storage-schemas"
import type { ProviderNetworkPolicyContinuationCoordinator } from "@/src/site-integrations/provider-network-policy-continuation"
import { createDispatchLease } from "@/src/runtime/dispatch-lease"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type {
  RuntimeMessageRequest,
  RuntimeMessageResponse,
} from "@/src/runtime/runtime-message-contracts"

const mocks = vi.hoisted(() => ({
  getLease: vi.fn(),
  notifyTerminalTask: vi.fn(async () => undefined),
  clearProgress: vi.fn(async () => undefined),
}))

vi.mock("@/entrypoints/background/download-queue-finalization", () => ({
  notifyTerminalDownloadTask: mocks.notifyTerminalTask,
}))

vi.mock("@/entrypoints/background/active-task-progress-bus", () => ({
  clearActiveTaskProgress: mocks.clearProgress,
  settleActiveTaskProgressChapter: vi.fn(async () => undefined),
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

const DOCUMENT_INSTANCE_ID = "disabled-provider-document-1"
const FINGERPRINT = "a".repeat(64)

const destinationService = {
  clearDestinationIssuesForTask: vi.fn(async () => undefined),
} as unknown as DestinationService

const finalizationDependencies = {
  settingsRepository: {
    getSettings: vi.fn(async () => DEFAULT_SETTINGS),
  },
  historyRepository: {
    markChapterAsDownloaded: vi.fn(async () => undefined),
    getDownloadedChapters: vi.fn(async () => []),
    restoreChapterFromCompletedTask: vi.fn(async () => true),
  },
} satisfies DownloadQueueFinalizationDependencies

function cancellationAcknowledgement(
  message: RuntimeMessageRequest<"OFFSCREEN_CANCEL_JOB">
): RuntimeMessageResponse<"OFFSCREEN_CANCEL_JOB"> {
  return {
    success: true,
    canceled: true,
    ...message.payload,
    status: "canceled",
    lastSequence: 0,
  }
}

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

describe("disabled provider task policy", () => {
  const nativeOutputCoordinator = {
    getLiveTaskIds: vi.fn(async () => [] as string[]),
    cancelTask: vi.fn(async () => undefined),
    armLiveness: vi.fn(async () => undefined),
  } as unknown as NativeOutputCoordinator
  const onQueueDrained = vi.fn(async () => undefined)

  async function failDisabledProviderTasks(
    queueRepository: QueueRepository,
    coordinator: NativeOutputCoordinator,
    enablement: SiteIntegrationEnablementMap,
    _ensureOffscreenReady: () => Promise<void>
  ): Promise<void> {
    const cancellationCoordinator = new DownloadTaskCancellationCoordinator(
      queueRepository,
      coordinator,
      destinationService,
      finalizationDependencies
    )
    const providerCoordinator = new ProviderPolicyQueueCoordinator(
      queueRepository,
      coordinator,
      cancellationCoordinator,
      {} as ProviderNetworkPolicyContinuationCoordinator
    )
    if (await providerCoordinator.failDisabledTasks(enablement)) {
      await onQueueDrained()
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mocks.getLease.mockResolvedValue({
      ...createDispatchLease({
        jobId: "job-1",
        attempt: 1,
        taskId: "pixiv-task",
        chapterId: "chapter-1",
        fingerprint: FINGERPRINT,
        saveMode: "downloads-api",
        now: 100,
      }),
      documentInstanceId: DOCUMENT_INSTANCE_ID,
    })
    vi.mocked(nativeOutputCoordinator.getLiveTaskIds).mockResolvedValue([])
    vi.mocked(nativeOutputCoordinator.cancelTask).mockResolvedValue(undefined)
    vi.mocked(nativeOutputCoordinator.armLiveness).mockResolvedValue(undefined)
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (message: unknown) => {
          const request =
            message as RuntimeMessageRequest<"OFFSCREEN_CANCEL_JOB">
          return cancellationAcknowledgement(request)
        }),
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

  it("orders terminal commit, exact cancellation, lease clear, native cleanup, and continuation", async () => {
    const pixivTask = createTask("pixiv-task", "pixiv-comic")
    const queue = [pixivTask]
    const events: string[] = []
    let activeLease = await mocks.getLease()
    mocks.getLease.mockImplementation(async () => activeLease)
    const interruptDownloadTask = vi.fn(
      async (input: { taskId: string; errorMessage: string; now: number }) => {
        events.push("terminal-commit")
        const task = queue.find((candidate) => candidate.id === input.taskId)
        if (!task) {
          return {
            outcome: "rejected" as const,
            reason: "task-not-found" as const,
          }
        }
        Object.assign(task, {
          status: "failed",
          activeBlock: undefined,
          errorMessage: input.errorMessage,
          completed: input.now,
        })
        return {
          outcome: "applied" as const,
          task,
          clearedLease: null,
        }
      }
    )
    const clearDispatchLease = vi.fn(async () => {
      events.push("clear-lease")
      const lease = activeLease
      activeLease = null
      return { outcome: "applied" as const, lease }
    })
    const queueRepository = {
      getQueue: vi.fn(async () => queue),
      getTask: vi.fn(async (taskId: string) =>
        queue.find((task) => task.id === taskId)
      ),
      getActiveDispatchLease: mocks.getLease,
      interruptDownloadTask,
      clearDispatchLease,
    } as unknown as QueueRepository
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      async (message: unknown) => {
        events.push("cancel")
        return cancellationAcknowledgement(
          message as RuntimeMessageRequest<"OFFSCREEN_CANCEL_JOB">
        )
      }
    )
    vi.mocked(nativeOutputCoordinator.cancelTask).mockImplementation(
      async () => {
        events.push("native-cleanup")
      }
    )
    mocks.clearProgress.mockImplementation(async () => {
      events.push("clear-progress")
    })
    mocks.notifyTerminalTask.mockImplementation(async () => {
      events.push("notify")
    })
    onQueueDrained.mockImplementation(async () => {
      events.push("continuation")
    })

    await failDisabledProviderTasks(
      queueRepository,
      nativeOutputCoordinator,
      { "pixiv-comic": false },
      vi.fn(async () => undefined)
    )
    await vi.waitFor(() => expect(onQueueDrained).toHaveBeenCalled())

    expect(interruptDownloadTask).toHaveBeenCalledTimes(1)
    expect(interruptDownloadTask).toHaveBeenCalledWith({
      taskId: pixivTask.id,
      errorMessage: "Integration disabled",
      now: expect.any(Number),
    })
    expect(pixivTask).toMatchObject({
      status: "failed",
      activeBlock: undefined,
      errorMessage: "Integration disabled",
      completed: expect.any(Number),
    })
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      target: "offscreen",
      type: "OFFSCREEN_CANCEL_JOB",
      payload: {
        jobId: "job-1",
        attempt: 1,
        taskId: "pixiv-task",
        chapterId: "chapter-1",
        fingerprint: FINGERPRINT,
        documentInstanceId: DOCUMENT_INSTANCE_ID,
      },
    })
    expect(clearDispatchLease).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        attempt: 1,
        taskId: "pixiv-task",
        chapterId: "chapter-1",
        fingerprint: FINGERPRINT,
        documentInstanceId: DOCUMENT_INSTANCE_ID,
      })
    )
    expect(nativeOutputCoordinator.cancelTask).toHaveBeenCalledWith(
      pixivTask.id,
      expect.objectContaining({
        jobId: "job-1",
        attempt: 1,
        taskId: "pixiv-task",
        chapterId: "chapter-1",
        fingerprint: FINGERPRINT,
        documentInstanceId: DOCUMENT_INSTANCE_ID,
      })
    )
    expect(events).toEqual([
      "terminal-commit",
      "cancel",
      "clear-lease",
      "native-cleanup",
      "clear-progress",
      "notify",
      "continuation",
    ])
    expect(mocks.notifyTerminalTask).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      failure: "throws",
      response: async () => {
        throw new Error("offscreen unavailable")
      },
    },
    {
      failure: "reports canceled false",
      response: async (message: unknown) => ({
        ...cancellationAcknowledgement(
          message as RuntimeMessageRequest<"OFFSCREEN_CANCEL_JOB">
        ),
        canceled: false,
        status: "active" as const,
      }),
    },
    {
      failure: "returns a mismatched acknowledgement",
      response: async (message: unknown) => ({
        ...cancellationAcknowledgement(
          message as RuntimeMessageRequest<"OFFSCREEN_CANCEL_JOB">
        ),
        fingerprint: "b".repeat(64),
      }),
    },
  ])(
    "quarantines the lease when cooperative cancellation $failure",
    async ({ response }) => {
      const task = createTask("pixiv-task", "pixiv-comic")
      const interruptDownloadTask = vi.fn(async () => {
        Object.assign(task, {
          status: "failed",
          errorMessage: "Integration disabled",
          completed: Date.now(),
        })
        return { outcome: "applied" as const, task, clearedLease: null }
      })
      const clearDispatchLease = vi.fn()
      const queueRepository = {
        getQueue: vi.fn(async () => [task]),
        getTask: vi.fn(async () => task),
        getActiveDispatchLease: mocks.getLease,
        interruptDownloadTask,
        clearDispatchLease,
      } as unknown as QueueRepository
      vi.mocked(chrome.runtime.sendMessage).mockImplementation(response)
      const ensureOffscreenReady = vi.fn(async () => undefined)

      await expect(
        failDisabledProviderTasks(
          queueRepository,
          nativeOutputCoordinator,
          { "pixiv-comic": false },
          ensureOffscreenReady
        )
      ).resolves.toBeUndefined()

      expect(interruptDownloadTask).toHaveBeenCalledTimes(1)
      expect(clearDispatchLease).not.toHaveBeenCalled()
      expect(nativeOutputCoordinator.cancelTask).not.toHaveBeenCalled()
      expect(nativeOutputCoordinator.armLiveness).toHaveBeenCalledOnce()
      expect(mocks.clearProgress).not.toHaveBeenCalled()
      expect(mocks.notifyTerminalTask).not.toHaveBeenCalled()
      expect(onQueueDrained).not.toHaveBeenCalled()
      expect(ensureOffscreenReady).not.toHaveBeenCalled()
    }
  )

  it("fails a default-disabled provider when no override exists", async () => {
    const task = createTask("mangadex-task", "mangadex")
    const interruptDownloadTask = vi.fn(
      async (input: { errorMessage: string; now: number }) => {
        Object.assign(task, {
          status: "failed",
          errorMessage: input.errorMessage,
          completed: input.now,
        })
        return {
          outcome: "applied" as const,
          task,
          clearedLease: null,
        }
      }
    )
    const queueRepository = {
      getQueue: vi.fn(async () => [task]),
      getTask: vi.fn(async () => task),
      getActiveDispatchLease: mocks.getLease,
      interruptDownloadTask,
      clearDispatchLease: vi.fn(),
    } as unknown as QueueRepository

    await failDisabledProviderTasks(
      queueRepository,
      nativeOutputCoordinator,
      {},
      vi.fn(async () => undefined)
    )

    expect(interruptDownloadTask).toHaveBeenCalledTimes(1)
    expect(task).toMatchObject({
      status: "failed",
      errorMessage: "Integration disabled",
    })
  })

  it("does not interrupt a task already handed to Chrome Downloads", async () => {
    const pixivTask = createTask("pixiv-task", "pixiv-comic")
    vi.mocked(nativeOutputCoordinator.getLiveTaskIds).mockResolvedValueOnce([
      pixivTask.id,
    ])
    const interruptDownloadTask = vi.fn()
    const queueRepository = {
      getQueue: vi.fn(async () => [pixivTask]),
      getActiveDispatchLease: mocks.getLease,
      interruptDownloadTask,
    } as unknown as QueueRepository

    await failDisabledProviderTasks(
      queueRepository,
      nativeOutputCoordinator,
      { "pixiv-comic": false },
      vi.fn(async () => undefined)
    )

    expect(interruptDownloadTask).not.toHaveBeenCalled()
  })

  it("rechecks native output ownership inside the task side-effect gate", async () => {
    const pixivTask = createTask("pixiv-task", "pixiv-comic")
    vi.mocked(nativeOutputCoordinator.getLiveTaskIds)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([pixivTask.id])
    const interruptDownloadTask = vi.fn()
    const queueRepository = {
      getQueue: vi.fn(async () => [pixivTask]),
      getActiveDispatchLease: mocks.getLease,
      interruptDownloadTask,
    } as unknown as QueueRepository

    await failDisabledProviderTasks(
      queueRepository,
      nativeOutputCoordinator,
      { "pixiv-comic": false },
      vi.fn(async () => undefined)
    )

    expect(nativeOutputCoordinator.getLiveTaskIds).toHaveBeenCalledTimes(2)
    expect(interruptDownloadTask).not.toHaveBeenCalled()
    expect(onQueueDrained).not.toHaveBeenCalled()
  })
})
