import { beforeEach, describe, expect, it, vi } from "vitest"

import { ChapterDispatchCoordinator } from "@/entrypoints/background/chapter-dispatch-coordinator"
import { DownloadTaskCancellationCoordinator } from "@/entrypoints/background/download-task-cancellation-coordinator"
import { DestinationService } from "@/entrypoints/background/destination"
import { DownloadTaskExecutor } from "@/entrypoints/background/download-task-executor"
import { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import { DownloadTaskStateSchema } from "@/src/runtime/queue-state-schemas"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { QueueRepository } from "@/src/storage/queue-repository"
import type { SiteIntegrationSessionRuleManager } from "@/src/site-integrations/session-rule-manager"
import type { ProviderPolicyQueueCoordinator } from "@/entrypoints/background/provider-policy-queue-coordinator"

const mocks = vi.hoisted(() => ({
  loadDownloadRootHandle: vi.fn(),
  queryFsaPermission: vi.fn(),
  resolveDownloadPlan: vi.fn(),
  sendRuntimeMessage: vi.fn(),
  resolveSiteIntegrationDispatchContext: vi.fn(),
  finishProgressEstimate: vi.fn(),
  validateDownloadPathForTask: vi.fn(),
}))

vi.mock("@/src/storage/fs-access", () => ({
  DOWNLOAD_ROOT_HANDLE_ID: "download-root",
  loadDownloadRootHandle: mocks.loadDownloadRootHandle,
  queryFsaPermission: mocks.queryFsaPermission,
}))

vi.mock("@/entrypoints/background/queue-helpers", () => ({
  resolveDownloadPlan: mocks.resolveDownloadPlan,
  validateDownloadPathForTask: mocks.validateDownloadPathForTask,
}))

vi.mock("@/src/runtime/send-runtime-message", () => ({
  sendRuntimeMessage: mocks.sendRuntimeMessage,
}))

vi.mock("@/src/runtime/site-integration-dispatch-context", () => ({
  resolveSiteIntegrationDispatchContext:
    mocks.resolveSiteIntegrationDispatchContext,
}))

vi.mock("@/src/storage/progress-timing-estimates-repository", () => ({
  progressTimingEstimatesRepository: {
    finish: mocks.finishProgressEstimate,
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

const itemId = "download-item"
const chapterId = "first-chapter"

function createSettings() {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.downloads.destination = "file-system-access"
  settings.downloads.pathTemplate = "TMD"
  return settings
}

function createTask(): DownloadTaskState {
  const settings = createSettings()
  return DownloadTaskStateSchema.parse({
    id: itemId,
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Series",
    created: 1,
    status: "queued",
    chapters: [
      {
        id: chapterId,
        url: "https://mangadex.org/chapter/first-chapter",
        title: "Chapter 1",
        index: 0,
        status: "queued",
        lastUpdated: 1,
      },
    ],
    settingsSnapshot: createTaskSettingsSnapshot(settings, "mangadex"),
  })
}

function createStorageState(): Record<string, unknown> {
  return {
    [LOCAL_STORAGE_KEYS.downloadQueue]: [createTask()],
    [LOCAL_STORAGE_KEYS.activeDispatchLease]: null,
    [LOCAL_STORAGE_KEYS.pendingUndoActions]: [],
  }
}

type Runtime = {
  queueRepository: QueueRepository
  destinationService: DestinationService
  executor: DownloadTaskExecutor
  interruption: ReturnType<typeof vi.spyOn>
}

function createRuntime(
  queueRepository = new QueueRepository(new QueueProjectionService())
): Runtime {
  const destinationService = new DestinationService({
    queueRepository,
    settingsReader: { getSettings: async () => createSettings() },
    notifier: { notifyDestinationActionRequired: async () => undefined },
  })
  const cancellation = new DownloadTaskCancellationCoordinator(
    queueRepository,
    {
      getLiveTaskIds: async () => [],
      cancelTask: async () => undefined,
      armLiveness: async () => undefined,
    } as never,
    {
      settingsRepository: { getSettings: async () => createSettings() },
      historyRepository: {
        getDownloadedChapters: async () => [],
        markChapterAsDownloaded: async () => undefined,
        restoreChapterFromCompletedTask: async () => true,
      },
    }
  )
  const interruption = vi.spyOn(cancellation, "interruptTask")
  const sessionRuleManager = {
    ensureNetworkReady: vi.fn(async () => undefined),
  } as unknown as SiteIntegrationSessionRuleManager
  const providerPolicyCoordinator = {
    acknowledgeAfterAdmission: vi.fn(async () => undefined),
  } as unknown as ProviderPolicyQueueCoordinator
  const enablement = {
    getAll: vi.fn(async () => ({ mangadex: true })),
  }
  const dispatch = new ChapterDispatchCoordinator(
    queueRepository,
    async <T>(operation: () => Promise<T>) => await operation(),
    cancellation,
    sessionRuleManager,
    destinationService,
    enablement,
    { getAll: vi.fn(async () => ({})), getForSite: vi.fn(async () => ({})) }
  )
  const executor = new DownloadTaskExecutor(
    queueRepository,
    vi.fn(async () => undefined),
    cancellation,
    providerPolicyCoordinator,
    dispatch,
    sessionRuleManager,
    destinationService,
    enablement,
    {
      settingsRepository: { getSettings: async () => createSettings() },
      historyRepository: {
        getDownloadedChapters: async () => [],
        markChapterAsDownloaded: async () => undefined,
        restoreChapterFromCompletedTask: async () => true,
      },
    }
  )
  return { queueRepository, destinationService, executor, interruption }
}

describe("destination recovery", () => {
  let local: Record<string, unknown>
  let storageSet: ReturnType<typeof vi.fn>
  let permissionResults: Array<"granted" | "prompt">
  let blockWriteFailure: Error | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    local = createStorageState()
    permissionResults = []
    blockWriteFailure = undefined

    storageSet = vi.fn(async (values: Record<string, unknown>) => {
      const queue = values[LOCAL_STORAGE_KEYS.downloadQueue]
      const includesDestinationBlock =
        Array.isArray(queue) &&
        queue.some(
          (entry) =>
            typeof entry === "object" &&
            entry !== null &&
            (entry as { activeBlock?: unknown }).activeBlock ===
              "destination_action_required"
        )
      if (blockWriteFailure && includesDestinationBlock) {
        const failure = blockWriteFailure
        blockWriteFailure = undefined
        throw failure
      }
      Object.assign(local, structuredClone(values))
    })

    vi.stubGlobal("chrome", {
      runtime: { id: "extension-id" },
      storage: {
        local: {
          get: vi.fn(async (keys: string | string[]) => {
            const requested = Array.isArray(keys) ? keys : [keys]
            return Object.fromEntries(
              requested.map((key) => [key, structuredClone(local[key])])
            )
          }),
          set: storageSet,
          remove: vi.fn(async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) {
              delete local[key]
            }
          }),
        },
        session: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
        },
      },
      action: {
        setBadgeText: vi.fn(async () => undefined),
        setBadgeBackgroundColor: vi.fn(async () => undefined),
      },
    } as unknown as typeof chrome)

    mocks.loadDownloadRootHandle.mockResolvedValue(
      {} as FileSystemDirectoryHandle
    )
    mocks.queryFsaPermission.mockImplementation(
      async () => permissionResults.shift() ?? "granted"
    )
    mocks.resolveDownloadPlan.mockResolvedValue({
      format: "cbz",
      book: {
        siteId: "mangadex",
        seriesId: "series-1",
        seriesTitle: "Series",
        comicInfoBase: { Series: "Series" },
      },
      chapters: [
        {
          id: chapterId,
          url: "https://mangadex.org/chapter/first-chapter",
          title: "Chapter 1",
          chapterNumber: 1,
          resolvedPath: "Series/Chapter 1.cbz",
          comicInfo: {},
        },
      ],
    })
    mocks.resolveSiteIntegrationDispatchContext.mockResolvedValue(undefined)
    mocks.validateDownloadPathForTask.mockResolvedValue(undefined)
    mocks.sendRuntimeMessage.mockImplementation(async (message) => ({
      success: true,
      accepted: true,
      jobId: message.payload.jobId,
      attempt: message.payload.attempt,
      taskId: message.payload.taskId,
      chapterId: message.payload.chapter.id,
      fingerprint: message.payload.fingerprint,
      documentInstanceId: "offscreen-document",
    }))
  })

  it("keeps the destination block repairable across a cold repository and resume", async () => {
    permissionResults = ["granted", "prompt", "granted", "granted"]
    const first = createRuntime()

    await expect(first.executor.execute(itemId)).resolves.toBe(
      "queue-continuation"
    )
    const coldRepository = new QueueRepository(new QueueProjectionService())
    const blocked = await coldRepository.getTask(itemId)
    expect(blocked).toMatchObject({
      status: "queued",
      activeBlock: "destination_action_required",
      destinationIssue: {
        taskId: itemId,
        chapterId,
        kind: "fsa_permission_required",
      },
    })

    await coldRepository.resumeDestinationTask({
      taskId: itemId,
      commandId: "repair-command",
      destinationOverride: undefined,
      now: 2,
    })
    const resumed = createRuntime(coldRepository)
    const scheduler = new QueueScheduler(
      coldRepository,
      resumed.executor,
      async () => undefined
    )
    await scheduler.activate()
    await expect(coldRepository.getTask(itemId)).resolves.toMatchObject({
      status: "downloading",
      chapters: [{ id: chapterId, status: "downloading" }],
    })
    await expect(coldRepository.getActiveDispatchLease()).resolves.toEqual(
      expect.objectContaining({ taskId: itemId, chapterId })
    )
  })

  it("surfaces a destination block persistence failure without terminalizing the chapter", async () => {
    permissionResults = ["granted", "prompt", "granted", "granted"]
    const persistenceFailure = new Error("destination block persistence failed")
    blockWriteFailure = persistenceFailure
    const runtime = createRuntime()

    await expect(runtime.executor.execute(itemId)).rejects.toBe(
      persistenceFailure
    )
    const coldRepository = new QueueRepository(new QueueProjectionService())
    const preserved = await coldRepository.getTask(itemId)
    expect(preserved).toMatchObject({
      status: "downloading",
      chapters: [{ id: chapterId, status: "queued" }],
    })
    expect(preserved).not.toHaveProperty("activeBlock")
    expect(preserved).not.toHaveProperty("destinationIssue")
    expect(preserved?.chapters[0]).not.toHaveProperty("errorCategory")
    expect(runtime.interruption).not.toHaveBeenCalled()

    const recovery = await coldRepository.recoverQueueAfterStartup({
      normalizationTime: 3,
      interruptedAt: 3,
      observedLease: null,
      offscreenJob: null,
      nativeOutputTaskIds: [],
    })
    expect(recovery).toMatchObject({
      outcome: "unchanged",
      resumeTaskId: itemId,
    })
    const resumed = createRuntime(coldRepository)
    const scheduler = new QueueScheduler(
      coldRepository,
      resumed.executor,
      async () => undefined
    )
    await scheduler.activateStartup({ kind: "resume-task", taskId: itemId })
    await expect(coldRepository.getActiveDispatchLease()).resolves.toEqual(
      expect.objectContaining({ taskId: itemId, chapterId })
    )
  })
})
