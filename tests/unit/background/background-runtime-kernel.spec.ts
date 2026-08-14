import { beforeEach, describe, expect, it, vi } from "vitest"

import type { DownloadTaskState } from "@/src/domain/queue/state"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import type { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import type { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import type { StartupQueueActivation } from "@/src/domain/queue/scheduler-policy"
import type { QueueRepository } from "@/src/storage/queue-repository"
import {
  InvalidDurableStateError,
  RuntimePhaseError,
} from "@/src/runtime/runtime-phase-errors"

const mocks = vi.hoisted(() => ({
  stateInitialize: vi.fn<() => Promise<void>>(async () => undefined),
  stateInstances: [] as object[],
  reconcilePermission: vi.fn<
    () => Promise<{
      changed: boolean
      enablement: Record<string, boolean>
    }>
  >(async () => ({
    changed: false,
    enablement: { mangadex: true },
  })),
  initializeMetadata: vi.fn(async () => undefined),
  applyEnablement: vi.fn(),
  registerAdapters: vi.fn(),
  recoverPendingUndo: vi.fn(async () => undefined),
  initializeFromStorage: vi.fn<
    () => Promise<{
      queue: DownloadTaskState[]
      queueActivation?: StartupQueueActivation
    }>
  >(async () => ({
    queue: [],
  })),
  reconcileHistory: vi.fn(async () => undefined),
  getSettings: vi.fn(async () => ({
    uiLanguage: "system",
    downloads: { defaultFormat: "cbz" },
  })),
  applyUiLanguage: vi.fn(async () => undefined),
  processQueue: vi.fn<() => Promise<void>>(async () => undefined),
  resumeTask: vi.fn(async (_taskId: string) => undefined),
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock("@/src/runtime/i18n", () => ({
  applyUiLanguagePreference: mocks.applyUiLanguage,
}))

vi.mock("@/src/site-integrations/host-permission-service", () => ({
  reconcileBroadHttpsPermissionEnablement: mocks.reconcilePermission,
}))

vi.mock("@/src/runtime/background-site-integration-initialization", () => ({
  validateBackgroundSiteIntegrations: mocks.registerAdapters,
}))

vi.mock("@/src/site-integrations/catalog", () => ({
  getDefinitions: () => [],
  setEnablementMap: mocks.applyEnablement,
}))

vi.mock("@/entrypoints/background/pending-undo-coordinator", () => ({
  recoverPendingUndoActions: mocks.recoverPendingUndo,
}))

vi.mock("@/entrypoints/background/initialize-from-storage", () => ({
  initializeFromStorage: mocks.initializeFromStorage,
}))

vi.mock("@/entrypoints/background/download-queue-finalization", () => ({
  reconcileCompletedChapterHistory: mocks.reconcileHistory,
}))

vi.mock("@/entrypoints/background/offscreen-lifecycle", () => ({
  getOffscreenContexts: vi.fn(async () => []),
  hasOffscreenDocument: vi.fn(async () => false),
  queryOffscreenJob: vi.fn(async () => null),
  queryOffscreenStatus: vi.fn(async () => null),
  scheduleOffscreenCloseIfIdle: vi.fn(async () => undefined),
  terminateOffscreenDocumentForUnboundLease: vi.fn(async () => undefined),
}))

import { BackgroundRuntimeKernel } from "@/entrypoints/background/background-runtime-kernel"

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createQueueRepository(): QueueRepository {
  return {
    initialize: vi.fn(async () => undefined),
    getActiveDispatchLease: vi.fn(async () => null),
  } as unknown as QueueRepository
}

function createNativeOutputCoordinator(): NativeOutputCoordinator {
  return {
    initialize: vi.fn(async () => undefined),
  } as unknown as NativeOutputCoordinator
}

function createKernel(input?: {
  queueRepository?: QueueRepository
  nativeOutputCoordinator?: NativeOutputCoordinator
  ensureLivenessAlarm?: () => Promise<void>
  awaitSchemaMigration?: () => Promise<void>
}) {
  const queueRepository = input?.queueRepository ?? createQueueRepository()
  const nativeOutputCoordinator =
    input?.nativeOutputCoordinator ?? createNativeOutputCoordinator()
  const ensureLivenessAlarm =
    input?.ensureLivenessAlarm ?? vi.fn(async () => undefined)
  const awaitSchemaMigration =
    input?.awaitSchemaMigration ?? vi.fn(async () => undefined)
  const queueScheduler = {
    activateStartup: vi.fn(async (activation: StartupQueueActivation) => {
      if (activation.kind === "resume-task") {
        await mocks.resumeTask(activation.taskId)
      } else {
        await mocks.processQueue()
      }
    }),
  } as unknown as QueueScheduler
  const tabContextStateService = {
    initialize: vi.fn(async () => {
      await mocks.stateInitialize()
    }),
  }
  mocks.stateInstances.push(tabContextStateService)
  const kernel = new BackgroundRuntimeKernel({
    settingsRepository: { getSettings: mocks.getSettings } as never,
    siteIntegrationEnablementService: {
      getAll: vi.fn(async () => ({ mangadex: true })),
    } as never,
    tabContextStateService: tabContextStateService as never,
    queueRepository,
    historyRepository: {} as never,
    nativeOutputCoordinator,
    ensureLivenessAlarm,
    setLivenessAlarmArmed: vi.fn(async () => undefined),
    queueScheduler,
    terminalCoordinator: {} as OffscreenJobTerminalCoordinator,
    destinationService: {} as never,
    awaitSchemaMigration,
  })
  return {
    kernel,
    queueRepository,
    nativeOutputCoordinator,
    ensureLivenessAlarm,
    awaitSchemaMigration,
  }
}

describe("BackgroundRuntimeKernel", () => {
  let sessionSet: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.stateInstances.length = 0
    mocks.reconcilePermission.mockResolvedValue({
      changed: false,
      enablement: { mangadex: true },
    })
    mocks.initializeFromStorage.mockResolvedValue({ queue: [] })
    sessionSet = vi.fn(async () => undefined)
    vi.stubGlobal("chrome", {
      storage: { session: { set: sessionSet } },
    } as unknown as typeof chrome)
  })

  it("holds every readiness phase behind the schema reset gate", async () => {
    const resetGate = deferred<void>()
    const { kernel, queueRepository, nativeOutputCoordinator } = createKernel({
      awaitSchemaMigration: () => resetGate.promise,
    })

    const queue = kernel.ensure("queue-hydrated")
    const runtime = kernel.ensure("runtime-ready")
    await Promise.resolve()
    expect(mocks.stateInitialize).not.toHaveBeenCalled()
    expect(queueRepository.initialize).not.toHaveBeenCalled()
    expect(nativeOutputCoordinator.initialize).not.toHaveBeenCalled()

    resetGate.resolve()
    await Promise.all([queue, runtime])
    expect(mocks.stateInitialize).toHaveBeenCalledOnce()
    expect(queueRepository.initialize).toHaveBeenCalledOnce()
    expect(nativeOutputCoordinator.initialize).toHaveBeenCalledOnce()
  })

  it("treats a rejected schema migration as sticky and fatal without hydrating", async () => {
    const resetError = new Error("storage unavailable")
    const { kernel, queueRepository } = createKernel({
      awaitSchemaMigration: () => Promise.reject(resetError),
    })

    await expect(kernel.ensure("queue-hydrated")).rejects.toThrow(
      "Retained state could not be migrated"
    )
    expect(mocks.stateInitialize).not.toHaveBeenCalled()
    expect(queueRepository.initialize).not.toHaveBeenCalled()
    expect(sessionSet).toHaveBeenCalledWith(
      expect.objectContaining({
        initFailed: true,
        error: expect.stringContaining("Retained state could not be migrated"),
      })
    )

    // The failure is sticky: later phases reject without retrying the reset.
    await expect(kernel.ensure("runtime-ready")).rejects.toThrow(
      "Retained state could not be migrated"
    )
    expect(mocks.stateInitialize).not.toHaveBeenCalled()
    expect(queueRepository.initialize).not.toHaveBeenCalled()
  })

  it("routes each readiness label to its exact minimum DAG phase", async () => {
    const { kernel, queueRepository, nativeOutputCoordinator } = createKernel()
    let controlResolved = false
    const control = kernel.ensure("control-ready").then(() => {
      controlResolved = true
    })
    await Promise.resolve()
    expect(controlResolved).toBe(false)

    kernel.markControlReady()
    await control
    expect(mocks.stateInitialize).not.toHaveBeenCalled()

    await kernel.ensure("queue-hydrated")
    expect(mocks.stateInitialize).toHaveBeenCalledOnce()
    expect(queueRepository.initialize).toHaveBeenCalledOnce()
    expect(mocks.reconcilePermission).not.toHaveBeenCalled()
    expect(nativeOutputCoordinator.initialize).not.toHaveBeenCalled()

    await kernel.ensure("integrations-ready")
    expect(mocks.stateInitialize).toHaveBeenCalledOnce()
    expect(mocks.reconcilePermission).toHaveBeenCalledOnce()
    expect(mocks.registerAdapters).toHaveBeenCalledOnce()
    expect(nativeOutputCoordinator.initialize).not.toHaveBeenCalled()

    await kernel.ensure("runtime-ready")
    expect(nativeOutputCoordinator.initialize).toHaveBeenCalledOnce()
    expect(mocks.initializeFromStorage).toHaveBeenCalledOnce()
  })

  it("keeps queue and integration work independent after shared state", async () => {
    const queueGate = deferred<void>()
    const queueRepository = createQueueRepository()
    vi.mocked(queueRepository.initialize).mockReturnValue(queueGate.promise)
    const { kernel } = createKernel({ queueRepository })

    const queue = kernel.ensure("queue-hydrated")
    const integrations = kernel.ensure("integrations-ready")
    await integrations

    expect(mocks.registerAdapters).toHaveBeenCalledOnce()
    expect(queueRepository.initialize).toHaveBeenCalledOnce()
    let queueResolved = false
    void queue.then(() => {
      queueResolved = true
    })
    await Promise.resolve()
    expect(queueResolved).toBe(false)
    queueGate.resolve()
    await queue
  })

  it("joins concurrent phase callers and keeps successful phases sticky", async () => {
    const queueGate = deferred<void>()
    const queueRepository = createQueueRepository()
    vi.mocked(queueRepository.initialize).mockReturnValue(queueGate.promise)
    const { kernel } = createKernel({ queueRepository })

    const first = kernel.ensure("queue-hydrated")
    const second = kernel.ensure("queue-hydrated")
    await vi.waitFor(() =>
      expect(queueRepository.initialize).toHaveBeenCalledOnce()
    )
    queueGate.resolve()
    await Promise.all([first, second])
    await kernel.ensure("queue-hydrated")

    expect(queueRepository.initialize).toHaveBeenCalledOnce()
    expect(mocks.stateInitialize).toHaveBeenCalledOnce()
  })

  it("retries only the incomplete phase after a transient failure", async () => {
    const queueRepository = createQueueRepository()
    vi.mocked(queueRepository.initialize)
      .mockRejectedValueOnce(new Error("temporary queue read failure"))
      .mockResolvedValueOnce(undefined)
    const { kernel } = createKernel({ queueRepository })

    await expect(kernel.ensure("queue-hydrated")).rejects.toMatchObject({
      phase: "queue-hydrated",
      fatal: false,
    })
    await kernel.ensure("integrations-ready")
    await kernel.ensure("queue-hydrated")

    expect(mocks.stateInitialize).toHaveBeenCalledOnce()
    expect(queueRepository.initialize).toHaveBeenCalledTimes(2)
    expect(mocks.reconcilePermission).toHaveBeenCalledOnce()
  })

  it("keeps fatal invalid durable state sticky until worker restart", async () => {
    const nativeOutputCoordinator = createNativeOutputCoordinator()
    vi.mocked(nativeOutputCoordinator.initialize).mockRejectedValue(
      new InvalidDurableStateError("Invalid durable pending output records")
    )
    const { kernel } = createKernel({ nativeOutputCoordinator })

    const first = await kernel.ensure("runtime-ready").catch((error) => error)
    const second = await kernel.ensure("runtime-ready").catch((error) => error)

    expect(first).toBeInstanceOf(RuntimePhaseError)
    expect(first).toMatchObject({ phase: "runtime-ready", fatal: true })
    expect(second).toBe(first)
    expect(nativeOutputCoordinator.initialize).toHaveBeenCalledOnce()
  })

  it("publishes only the latest integration generation", async () => {
    const oldGeneration = deferred<{
      changed: boolean
      enablement: Record<string, boolean>
    }>()
    mocks.reconcilePermission
      .mockReturnValueOnce(oldGeneration.promise)
      .mockResolvedValueOnce({
        changed: false,
        enablement: { mangadex: false },
      })
    const { kernel } = createKernel()

    const initial = kernel.ensure("integrations-ready")
    await vi.waitFor(() =>
      expect(mocks.reconcilePermission).toHaveBeenCalledOnce()
    )
    const refresh = kernel.refreshIntegrations()
    await vi.waitFor(() =>
      expect(mocks.reconcilePermission).toHaveBeenCalledTimes(2)
    )
    oldGeneration.resolve({
      changed: false,
      enablement: { mangadex: true },
    })
    await Promise.all([initial, refresh])

    expect(mocks.applyEnablement).toHaveBeenCalledOnce()
    expect(mocks.applyEnablement).toHaveBeenCalledWith({ mangadex: false })
    expect(mocks.registerAdapters).toHaveBeenCalledOnce()
  })

  it("waits for the current integration generation without replaying runtime recovery", async () => {
    const { kernel, nativeOutputCoordinator } = createKernel()
    await kernel.ensure("runtime-ready")
    const refreshGate = deferred<{
      changed: boolean
      enablement: Record<string, boolean>
    }>()
    mocks.reconcilePermission.mockReturnValueOnce(refreshGate.promise)

    const refresh = kernel.refreshIntegrations()
    const runtime = kernel.ensure("runtime-ready")
    let runtimeResolved = false
    void runtime.then(() => {
      runtimeResolved = true
    })
    await Promise.resolve()
    expect(runtimeResolved).toBe(false)

    refreshGate.resolve({ changed: false, enablement: { mangadex: true } })
    await Promise.all([refresh, runtime])
    expect(nativeOutputCoordinator.initialize).toHaveBeenCalledOnce()
    expect(mocks.initializeFromStorage).toHaveBeenCalledOnce()
  })

  it("exposes the state manager only after its internal phase completes", async () => {
    const stateGate = deferred<void>()
    mocks.stateInitialize.mockReturnValueOnce(stateGate.promise)
    const { kernel } = createKernel()

    expect(() => kernel.getTabContextStateService()).toThrow(
      "Tab context state is not ready"
    )
    const state = kernel.ensure("integrations-ready")
    expect(() => kernel.getTabContextStateService()).toThrow(
      "Tab context state is not ready"
    )
    stateGate.resolve()
    await state
    expect(kernel.getTabContextStateService()).toBe(mocks.stateInstances[0])
  })

  it("writes failure diagnostics and clears them only after full success", async () => {
    const queueRepository = createQueueRepository()
    vi.mocked(queueRepository.initialize)
      .mockRejectedValueOnce(new Error("queue unavailable"))
      .mockResolvedValueOnce(undefined)
    const { kernel } = createKernel({ queueRepository })

    await expect(kernel.ensure("queue-hydrated")).rejects.toThrow(
      "queue unavailable"
    )
    expect(sessionSet).toHaveBeenCalledWith({
      initFailed: true,
      error: "queue unavailable",
    })
    expect(sessionSet).not.toHaveBeenCalledWith({
      initFailed: false,
      error: null,
    })

    await kernel.ensure("runtime-ready")
    expect(sessionSet).toHaveBeenCalledWith({
      initFailed: false,
      error: null,
    })
  })

  it("arms durable liveness after retryable eager startup failure and reruns only incomplete phases", async () => {
    const queueRepository = createQueueRepository()
    vi.mocked(queueRepository.initialize)
      .mockRejectedValueOnce(new Error("queue unavailable during eager start"))
      .mockResolvedValueOnce(undefined)
    const ensureLivenessAlarm = vi.fn(async () => undefined)
    const { kernel, nativeOutputCoordinator } = createKernel({
      queueRepository,
      ensureLivenessAlarm,
    })

    kernel.start()

    await vi.waitFor(() => expect(ensureLivenessAlarm).toHaveBeenCalledOnce())
    expect(sessionSet).toHaveBeenCalledWith({
      initFailed: true,
      error: "queue unavailable during eager start",
    })

    await kernel.ensure("runtime-ready")

    expect(mocks.stateInitialize).toHaveBeenCalledOnce()
    expect(queueRepository.initialize).toHaveBeenCalledTimes(2)
    expect(mocks.reconcilePermission).toHaveBeenCalledOnce()
    expect(nativeOutputCoordinator.initialize).toHaveBeenCalledOnce()
    expect(mocks.initializeFromStorage).toHaveBeenCalledOnce()
    expect(sessionSet).toHaveBeenCalledWith({
      initFailed: false,
      error: null,
    })
  })

  it("does not arm liveness after fatal eager startup failure", async () => {
    const nativeOutputCoordinator = createNativeOutputCoordinator()
    vi.mocked(nativeOutputCoordinator.initialize).mockRejectedValueOnce(
      new InvalidDurableStateError("invalid pending outputs")
    )
    const ensureLivenessAlarm = vi.fn(async () => undefined)
    const { kernel } = createKernel({
      nativeOutputCoordinator,
      ensureLivenessAlarm,
    })

    kernel.start()

    await vi.waitFor(() =>
      expect(sessionSet).toHaveBeenCalledWith({
        initFailed: true,
        error: "invalid pending outputs",
      })
    )
    expect(ensureLivenessAlarm).not.toHaveBeenCalled()
  })

  it("waits for a generation superseded during final diagnostics before activation", async () => {
    const refreshGate = deferred<{
      changed: boolean
      enablement: Record<string, boolean>
    }>()
    mocks.reconcilePermission
      .mockResolvedValueOnce({
        changed: false,
        enablement: { mangadex: true },
      })
      .mockReturnValueOnce(refreshGate.promise)
    mocks.initializeFromStorage.mockResolvedValueOnce({
      queue: [],
      queueActivation: { kind: "process-queue" },
    })
    const { kernel, nativeOutputCoordinator } = createKernel()
    let refreshPromise: Promise<void> | undefined
    sessionSet.mockImplementation(async (values: Record<string, unknown>) => {
      if (values.initFailed === false && !refreshPromise) {
        refreshPromise = kernel.refreshIntegrations()
      }
    })

    kernel.start()

    await vi.waitFor(() =>
      expect(mocks.reconcilePermission).toHaveBeenCalledTimes(2)
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.processQueue).not.toHaveBeenCalled()
    expect(nativeOutputCoordinator.initialize).toHaveBeenCalledOnce()
    expect(mocks.initializeFromStorage).toHaveBeenCalledOnce()

    refreshGate.resolve({
      changed: false,
      enablement: { mangadex: false },
    })
    await refreshPromise
    await vi.waitFor(() => expect(mocks.processQueue).toHaveBeenCalledOnce())

    expect(nativeOutputCoordinator.initialize).toHaveBeenCalledOnce()
    expect(mocks.initializeFromStorage).toHaveBeenCalledOnce()
    expect(mocks.applyEnablement).toHaveBeenLastCalledWith({ mangadex: false })
  })

  it("eagerly activates single-flight, re-arms liveness on failure, and retries", async () => {
    const ensureLivenessAlarm = vi.fn(async () => undefined)
    mocks.initializeFromStorage.mockResolvedValueOnce({
      queue: [],
      queueActivation: { kind: "process-queue" },
    })
    const activationGate = deferred<void>()
    mocks.processQueue
      .mockReturnValueOnce(activationGate.promise)
      .mockResolvedValueOnce(undefined)
    const { kernel } = createKernel({ ensureLivenessAlarm })

    kernel.start()
    kernel.start()
    await kernel.ensure("runtime-ready")
    await vi.waitFor(() => expect(mocks.processQueue).toHaveBeenCalledOnce())
    activationGate.reject(new Error("activation failed"))
    await vi.waitFor(() => expect(ensureLivenessAlarm).toHaveBeenCalledOnce())

    kernel.start()
    await vi.waitFor(() => expect(mocks.processQueue).toHaveBeenCalledTimes(2))
  })
})
