import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { QueueRepository } from "@/src/storage/queue-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { HistoryRepository } from "@/src/storage/history-repository"
import type { DownloadQueueFinalizationDependencies } from "@/entrypoints/background/download-queue-finalization"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type {
  ActiveDispatchLease,
  DownloadTaskState,
  PendingUndoAction,
} from "@/src/domain/queue/state"
import type { ChapterState } from "@/src/types/tab-state"
import { type Mock, vi } from "vitest"
import type { DestinationService } from "@/entrypoints/background/destination"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import type { SiteIntegrationSessionRuleManager } from "@/src/site-integrations/session-rule-manager"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import { DownloadTaskExecutor } from "@/entrypoints/background/download-task-executor"
import { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import { DownloadTaskCancellationCoordinator } from "@/entrypoints/background/download-task-cancellation-coordinator"
import { ProviderPolicyQueueCoordinator } from "@/entrypoints/background/provider-policy-queue-coordinator"
import { ChapterDispatchCoordinator } from "@/entrypoints/background/chapter-dispatch-coordinator"
import type { SiteIntegrationEnablementMap } from "@/src/domain/site-integrations/storage-schemas"
import type { ProviderNetworkPolicyContinuationCoordinator } from "@/src/site-integrations/provider-network-policy-continuation"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"

export const mockEnsureSiteIntegrationNetworkReady =
  vi.fn<(siteIntegrationId: string) => Promise<void>>()
export const mockSessionRuleManager = {
  ensureNetworkReady: mockEnsureSiteIntegrationNetworkReady,
} as unknown as SiteIntegrationSessionRuleManager
export const mockProviderNetworkPolicyContinuation = {
  readContinuation: vi.fn(async () => ({
    revision: 1,
    consumed: false,
  })),
  clearContinuation: vi.fn(async () => undefined),
  isContinuationCurrent: vi.fn(() => true),
} as unknown as ProviderNetworkPolicyContinuationCoordinator

vi.mock("../../entrypoints/background/queue-helpers", () => ({
  resolveDownloadPlan: vi.fn().mockResolvedValue({
    format: "cbz",
    overwriteExisting: false,
    book: {
      siteId: "test-site",
      seriesId: "series-1",
      seriesTitle: "Test Manga",
      comicInfoBase: { Series: "Test Manga" },
    },
    chapters: [
      {
        id: "ch1",
        url: "https://example.com/ch1",
        title: "Chapter 1",
        chapterNumber: 1,
        resolvedPath: "/downloads/Test Manga/Chapter 1.cbz",
      },
    ],
  }),
  validateDownloadPathForTask: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("@/src/runtime/background-site-integration-initialization", () => ({
  getBackgroundSiteAdapterById: vi.fn().mockResolvedValue(undefined),
}))

export let mockQueueRepository: QueueRepository
export let historyRepository: HistoryRepository
export let finalizationDependencies: DownloadQueueFinalizationDependencies
function createMockSiteIntegrationEnablementService(): {
  getAll: Mock<() => Promise<Record<string, boolean>>>
} {
  return {
    getAll: vi.fn(async () => ({}) as Record<string, boolean>),
  }
}

export let mockSiteIntegrationEnablementService =
  createMockSiteIntegrationEnablementService()
export let mockEnsureOffscreenReady: () => Promise<void>
export let mockRunOffscreenDocumentAdmissionExclusive: <T>(
  operation: () => Promise<T>
) => Promise<T>
export let mockRuntimeSendMessage: ReturnType<typeof vi.fn>
export let mockTaskExecutor: DownloadTaskExecutor
export let mockQueueScheduler: QueueScheduler
export let mockTerminalCoordinator: OffscreenJobTerminalCoordinator
export let mockProviderPolicyCoordinator: ProviderPolicyQueueCoordinator
export const mockDestinationService = {
  getIssues: vi.fn(async () => []),
  recordDestinationIssue: vi.fn(async () => undefined),
  recordDestinationRuntimeIssue: vi.fn(async () => undefined),
  clearDestinationIssuesForTask: vi.fn(async () => undefined),
  getEffectiveDestination: vi.fn(async () => ({ kind: "downloads" as const })),
  preflight: vi.fn(async () => ({ ready: true as const })),
} as unknown as DestinationService
export const mockRateLimitService = {
  resolveEffectivePolicy: vi.fn(async () => ({ concurrency: 1, delayMs: 0 })),
  scheduleForIntegrationScope: vi.fn(
    async <T>(_id: string, _scope: string, task: () => Promise<T>) => task()
  ),
  cleanupRateLimiters: vi.fn(),
} as unknown as RateLimitService
let mockOnQueueDrained: (() => Promise<void>) | null = null
const pendingNativeManifests: Array<
  Parameters<NativeOutputCoordinator["sealManifest"]>[0]
> = []
export const mockNativeOutputCoordinator = {
  getLiveTaskIds: vi.fn(async () => [
    ...new Set(pendingNativeManifests.map((manifest) => manifest.taskId)),
  ]),
  sealManifest: vi.fn(
    async (
      manifest: Parameters<NativeOutputCoordinator["sealManifest"]>[0]
    ) => {
      pendingNativeManifests.push(manifest)
    }
  ),
  reconcile: vi.fn(async () => {
    while (pendingNativeManifests.length > 0) {
      const manifest = pendingNativeManifests.shift()!
      const interrupted = manifest.outputsFailedBeforeHandoff
      await mockQueueRepository.applyNativeOutputSettlement({
        jobId: manifest.jobId,
        attempt: manifest.attempt,
        taskId: manifest.taskId,
        chapterId: manifest.chapterId,
        requested: manifest.outputsRequested,
        completed: manifest.outputsRequested - interrupted,
        interrupted,
        surrendered: 0,
        now: Date.now(),
      })
    }
  }),
  cancelTask: vi.fn(async () => undefined),
  armLiveness: vi.fn(async () => undefined),
} as unknown as NativeOutputCoordinator
export let mockGlobalState: {
  downloadQueue: DownloadTaskState[]
  settings: typeof testSettings
  lastActivity: number
}

export const testSettings = {
  ...DEFAULT_SETTINGS,
  downloads: {
    ...DEFAULT_SETTINGS.downloads,
    pathTemplate: "/downloads",
  },
}

export const createChapter = (
  partial: Partial<ChapterState>
): ChapterState => ({
  id:
    partial.id ??
    (() => {
      const fallbackUrl = partial.url ?? "https://example.com/ch1"
      try {
        return (
          new URL(fallbackUrl).pathname.split("/").filter(Boolean).at(-1) ??
          "ch1"
        )
      } catch {
        return fallbackUrl
      }
    })(),
  url: partial.url || "https://example.com/ch1",
  title: partial.title || "Chapter 1",
  index: partial.index ?? 1,
  chapterNumber: partial.chapterNumber,
  status: partial.status || "queued",
  lastUpdated: partial.lastUpdated || Date.now(),
  ...partial,
})

export const makeTask = (
  overrides: Partial<DownloadTaskState> = {}
): DownloadTaskState => {
  const siteIntegrationId = overrides.siteIntegrationId ?? "test-site"
  return {
    id: overrides.id ?? "task-1",
    siteIntegrationId,
    mangaId: overrides.mangaId ?? "series-1",
    seriesTitle: overrides.seriesTitle ?? "Test Manga",
    chapters: overrides.chapters ?? [
      createChapter({
        url: "https://example.com/ch1",
        title: "Chapter 1",
        chapterNumber: 1,
      }),
    ],
    status: overrides.status ?? "queued",
    created: overrides.created ?? Date.now(),
    completed: overrides.completed,
    started: overrides.started,
    errorMessage: overrides.errorMessage,
    activeBlock: overrides.activeBlock,
    lastSuccessfulDownloadId: overrides.lastSuccessfulDownloadId,
    isRetried: overrides.isRetried,
    isRetryTask: overrides.isRetryTask,
    settingsSnapshot:
      overrides.settingsSnapshot ??
      createTaskSettingsSnapshot(testSettings, siteIntegrationId),
  }
}

export function configureDownloadQueueTestLifecycle(input: {
  onQueueDrained: (() => Promise<void>) | null
}): void {
  mockOnQueueDrained = input.onQueueDrained
}

export async function startDownloadTask(
  stateManager: QueueRepository,
  taskId: string,
  ensureOffscreenReady: () => Promise<void>,
  resumeExistingTask = false
): Promise<void> {
  if (
    stateManager !== mockQueueRepository ||
    ensureOffscreenReady !== mockEnsureOffscreenReady
  ) {
    throw new Error("Download queue test harness dependency mismatch")
  }
  const outcome = await mockTaskExecutor.execute(taskId, resumeExistingTask)
  if (outcome === "queue-continuation") {
    mockQueueScheduler.requestContinuation()
  }
}

export async function processDownloadQueue(
  stateManager: QueueRepository,
  ensureOffscreenReady: () => Promise<void>
): Promise<void> {
  if (
    stateManager !== mockQueueRepository ||
    ensureOffscreenReady !== mockEnsureOffscreenReady
  ) {
    throw new Error("Download queue test harness dependency mismatch")
  }
  await mockQueueScheduler.activate()
}

export async function handleOffscreenJobTerminal(input: {
  stateManager: QueueRepository
  nativeOutputCoordinator: NativeOutputCoordinator
  ensureOffscreenReady: () => Promise<void>
  payload: RuntimeMessageRequest<"OFFSCREEN_JOB_TERMINAL">["payload"]
}): Promise<void> {
  if (
    input.stateManager !== mockQueueRepository ||
    input.nativeOutputCoordinator !== mockNativeOutputCoordinator ||
    input.ensureOffscreenReady !== mockEnsureOffscreenReady
  ) {
    throw new Error("Download queue test harness dependency mismatch")
  }
  await mockTerminalCoordinator.handle(input.payload)
}

export async function continueDownloadTaskAfterChapterSettlement(input: {
  stateManager: QueueRepository
  taskId: string
  ensureOffscreenReady: () => Promise<void>
}): Promise<void> {
  if (
    input.stateManager !== mockQueueRepository ||
    input.ensureOffscreenReady !== mockEnsureOffscreenReady
  ) {
    throw new Error("Download queue test harness dependency mismatch")
  }
  await mockTerminalCoordinator.continueTask(input.taskId)
}

export async function resumeProviderPolicyBlockedQueue(
  stateManager: QueueRepository,
  ensureOffscreenReady: () => Promise<void>
): Promise<void> {
  if (
    stateManager !== mockQueueRepository ||
    ensureOffscreenReady !== mockEnsureOffscreenReady
  ) {
    throw new Error("Download queue test harness dependency mismatch")
  }
  if (await mockProviderPolicyCoordinator.resumeBlockedQueue()) {
    await mockQueueScheduler.activate()
  }
}

export async function failDisabledProviderTasks(
  stateManager: QueueRepository,
  nativeOutputCoordinator: NativeOutputCoordinator,
  enablement: SiteIntegrationEnablementMap,
  ensureOffscreenReady: () => Promise<void>
): Promise<void> {
  if (
    stateManager !== mockQueueRepository ||
    nativeOutputCoordinator !== mockNativeOutputCoordinator ||
    ensureOffscreenReady !== mockEnsureOffscreenReady
  ) {
    throw new Error("Download queue test harness dependency mismatch")
  }
  if (await mockProviderPolicyCoordinator.failDisabledTasks(enablement)) {
    await mockQueueScheduler.activate()
  }
}

export async function resetDownloadQueueTestEnvironment(): Promise<void> {
  vi.clearAllMocks()
  pendingNativeManifests.length = 0
  vi.mocked(mockNativeOutputCoordinator.getLiveTaskIds).mockImplementation(
    async () => [
      ...new Set(pendingNativeManifests.map((manifest) => manifest.taskId)),
    ]
  )
  vi.mocked(mockNativeOutputCoordinator.sealManifest).mockImplementation(
    async (manifest) => {
      pendingNativeManifests.push(manifest)
    }
  )
  vi.mocked(mockNativeOutputCoordinator.reconcile).mockImplementation(
    async () => {
      while (pendingNativeManifests.length > 0) {
        const manifest = pendingNativeManifests.shift()!
        const interrupted = manifest.outputsFailedBeforeHandoff
        await mockQueueRepository.applyNativeOutputSettlement({
          jobId: manifest.jobId,
          attempt: manifest.attempt,
          taskId: manifest.taskId,
          chapterId: manifest.chapterId,
          requested: manifest.outputsRequested,
          completed: manifest.outputsRequested - interrupted,
          interrupted,
          surrendered: 0,
          now: Date.now(),
        })
      }
    }
  )
  vi.mocked(mockNativeOutputCoordinator.cancelTask).mockResolvedValue(undefined)
  vi.mocked(mockNativeOutputCoordinator.armLiveness).mockResolvedValue(
    undefined
  )
  vi.mocked(mockDestinationService.getEffectiveDestination).mockResolvedValue({
    kind: "downloads",
  })
  vi.mocked(mockDestinationService.preflight).mockResolvedValue({ ready: true })
  vi.mocked(mockDestinationService.getIssues).mockResolvedValue([])
  vi.mocked(
    mockDestinationService.clearDestinationIssuesForTask
  ).mockResolvedValue(undefined)
  if (vi.isMockFunction(mockEnsureSiteIntegrationNetworkReady)) {
    mockEnsureSiteIntegrationNetworkReady.mockResolvedValue(undefined)
  }

  mockGlobalState = {
    downloadQueue: [],
    lastActivity: Date.now(),
    settings: testSettings,
  }

  historyRepository = new HistoryRepository()
  vi.spyOn(historyRepository, "markChapterAsDownloaded")
  vi.spyOn(historyRepository, "getDownloadedChapters").mockResolvedValue([])
  vi.spyOn(
    historyRepository,
    "restoreChapterFromCompletedTask"
  ).mockResolvedValue(true)
  finalizationDependencies = {
    settingsRepository: {
      getSettings: vi.fn(async () => mockGlobalState.settings),
    },
    historyRepository,
  }
  mockSiteIntegrationEnablementService = {
    getAll: vi.fn(async () => {
      const result = await chrome.storage.local.get("siteIntegrationEnablement")
      return (result.siteIntegrationEnablement ?? {}) as Record<string, boolean>
    }),
  }

  let activeDispatchLease: ActiveDispatchLease | null = null
  let pendingUndoActions: PendingUndoAction[] = []

  mockEnsureOffscreenReady = vi
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined)
  mockRunOffscreenDocumentAdmissionExclusive = vi.fn(
    async <T>(operation: () => Promise<T>): Promise<T> => await operation()
  ) as typeof mockRunOffscreenDocumentAdmissionExclusive
  mockRuntimeSendMessage = vi.fn().mockResolvedValue({
    success: true,
    status: "completed",
    outputsRequested: 1,
    outputsFailedBeforeHandoff: 0,
  })
  mockOnQueueDrained = null

  const chromeMock = {
    runtime: {
      sendMessage: mockRuntimeSendMessage,
    },
    storage: {
      session: (() => {
        const values: Record<string, unknown> = {}
        return {
          get: vi.fn(async (key: string) => ({ [key]: values[key] })),
          set: vi.fn(async (input: Record<string, unknown>) => {
            Object.assign(values, input)
          }),
          remove: vi.fn(async (key: string) => {
            delete values[key]
          }),
        }
      })(),
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const requested = Array.isArray(keys) ? keys : [keys]
          const result: Record<string, unknown> = {}
          for (const key of requested) {
            switch (key) {
              case LOCAL_STORAGE_KEYS.downloadQueue:
                result[key] = structuredClone(mockGlobalState.downloadQueue)
                break
              case LOCAL_STORAGE_KEYS.activeDispatchLease:
                result[key] = structuredClone(activeDispatchLease)
                break
              case LOCAL_STORAGE_KEYS.pendingUndoActions:
                result[key] = structuredClone(pendingUndoActions)
                break
            }
          }
          return result
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          if (Object.hasOwn(values, LOCAL_STORAGE_KEYS.downloadQueue)) {
            mockGlobalState = {
              ...mockGlobalState,
              downloadQueue: structuredClone(
                values[LOCAL_STORAGE_KEYS.downloadQueue]
              ) as DownloadTaskState[],
            }
          }
          if (Object.hasOwn(values, LOCAL_STORAGE_KEYS.activeDispatchLease)) {
            activeDispatchLease = structuredClone(
              values[LOCAL_STORAGE_KEYS.activeDispatchLease]
            ) as ActiveDispatchLease | null
          }
          if (Object.hasOwn(values, LOCAL_STORAGE_KEYS.pendingUndoActions)) {
            pendingUndoActions = structuredClone(
              values[LOCAL_STORAGE_KEYS.pendingUndoActions]
            ) as PendingUndoAction[]
          }
        }),
      },
    },
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
    },
  }
  vi.stubGlobal("chrome", chromeMock)
  ;(globalThis as { chrome?: unknown }).chrome = chromeMock

  mockQueueRepository = new QueueRepository(new QueueProjectionService())
  vi.spyOn(mockQueueRepository, "getQueue")
  vi.spyOn(mockQueueRepository, "getTask")
  vi.spyOn(mockQueueRepository, "getActiveDispatchLease")
  vi.spyOn(mockQueueRepository, "startDownloadTask")
  vi.spyOn(mockQueueRepository, "beginChapterDispatch")
  vi.spyOn(mockQueueRepository, "updateChapterProgress")
  vi.spyOn(mockQueueRepository, "settleTaskChapter")
  vi.spyOn(mockQueueRepository, "applyNativeOutputSettlement")
  vi.spyOn(mockQueueRepository, "recordTaskDispatchError")
  vi.spyOn(mockQueueRepository, "setNextChapterDispatchAt")
  vi.spyOn(mockQueueRepository, "clearDispatchLease")
  vi.spyOn(mockQueueRepository, "blockTaskForDestination")
  vi.spyOn(mockQueueRepository, "releaseDestinationBlock")
  vi.spyOn(mockQueueRepository, "blockTaskForProviderPolicy")
  vi.spyOn(mockQueueRepository, "releaseProviderPolicyBlock")
  vi.spyOn(mockQueueRepository, "releaseProviderPolicyBlocks")
  vi.spyOn(mockQueueRepository, "interruptDownloadTask")

  const cancellationCoordinator = new DownloadTaskCancellationCoordinator(
    mockQueueRepository,
    mockNativeOutputCoordinator,
    mockDestinationService,
    finalizationDependencies
  )
  mockProviderPolicyCoordinator = new ProviderPolicyQueueCoordinator(
    mockQueueRepository,
    mockNativeOutputCoordinator,
    cancellationCoordinator,
    mockProviderNetworkPolicyContinuation
  )
  const chapterDispatchCoordinator = new ChapterDispatchCoordinator(
    mockQueueRepository,
    mockRunOffscreenDocumentAdmissionExclusive,
    cancellationCoordinator,
    mockSessionRuleManager,
    mockDestinationService,
    mockSiteIntegrationEnablementService,
    {
      getAll: vi.fn(async () => ({})),
      getForSite: vi.fn(async () => ({})),
    }
  )
  mockTaskExecutor = new DownloadTaskExecutor(
    mockQueueRepository,
    mockEnsureOffscreenReady,
    cancellationCoordinator,
    mockProviderPolicyCoordinator,
    chapterDispatchCoordinator,
    mockSessionRuleManager,
    mockDestinationService,
    mockSiteIntegrationEnablementService,
    finalizationDependencies
  )
  mockQueueScheduler = new QueueScheduler(
    mockQueueRepository,
    mockTaskExecutor,
    async () => await mockOnQueueDrained?.()
  )
  mockTerminalCoordinator = new OffscreenJobTerminalCoordinator(
    mockQueueRepository,
    mockNativeOutputCoordinator,
    mockQueueScheduler,
    mockDestinationService,
    finalizationDependencies
  )
}
