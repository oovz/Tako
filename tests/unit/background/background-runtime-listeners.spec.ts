import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/src/runtime/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

const recoveryMocks = vi.hoisted(() => ({
  recoverFromLivenessTimeout: vi.fn(async () => undefined),
  refreshLivenessAlarmForDurableWork: vi.fn(async () => undefined),
}))
const pendingUndoMocks = vi.hoisted(() => ({
  finalizePendingUndoAndCleanup: vi.fn(async () => undefined),
}))
const progressPortMocks = vi.hoisted(() => ({
  registerActiveTaskProgressPort: vi.fn(),
}))

vi.mock("@/entrypoints/background/pending-undo-coordinator", () => ({
  finalizePendingUndoAndCleanup: pendingUndoMocks.finalizePendingUndoAndCleanup,
}))

vi.mock("@/entrypoints/background/active-task-progress-bus", async () => {
  const actual = await vi.importActual<
    typeof import("@/entrypoints/background/active-task-progress-bus")
  >("@/entrypoints/background/active-task-progress-bus")
  return {
    ...actual,
    registerActiveTaskProgressPort:
      progressPortMocks.registerActiveTaskProgressPort,
  }
})

vi.mock("@/entrypoints/background/offscreen-lifecycle", () => ({
  recoverFromLivenessTimeout: recoveryMocks.recoverFromLivenessTimeout,
  refreshLivenessAlarmForDurableWork:
    recoveryMocks.refreshLivenessAlarmForDurableWork,
}))

import { registerBackgroundRuntimeListeners } from "@/entrypoints/background/background-runtime-listeners"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import type { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import type { ProviderPolicyQueueCoordinator } from "@/entrypoints/background/provider-policy-queue-coordinator"
import type { SettingsRepository } from "@/src/storage/settings-repository"
import type { DestinationService } from "@/entrypoints/background/destination"
import type { TabContextStateService } from "@/entrypoints/background/tab-context-state-service"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"

type ListenerDependencies = Parameters<
  typeof registerBackgroundRuntimeListeners
>[0]

function createNativeOutputCoordinatorStub(): NativeOutputCoordinator {
  return {
    handleDownloadChanged: vi.fn(async () => false),
    handleDownloadErased: vi.fn(async () => false),
    reconcile: vi.fn(async () => undefined),
  } as unknown as NativeOutputCoordinator
}

function createListenerDependencies(
  overrides: Partial<ListenerDependencies> = {}
): ListenerDependencies {
  return {
    waitForReadiness: vi.fn(async () => undefined),
    getTabContextStateService: vi.fn(
      () =>
        ({
          clearTabState: vi.fn(async () => undefined),
        }) as unknown as TabContextStateService
    ),
    queueRepository: {} as QueueRepository,
    nativeOutputCoordinator: createNativeOutputCoordinatorStub(),
    queueScheduler: {
      activate: vi.fn(async () => undefined),
      resumeTask: vi.fn(async () => undefined),
    } as unknown as QueueScheduler,
    terminalCoordinator: {} as OffscreenJobTerminalCoordinator,
    providerPolicyQueueCoordinator: {
      resumeBlockedQueue: vi.fn(async () => false),
    } as unknown as ProviderPolicyQueueCoordinator,
    tabContextCache: {
      handleTabRemoved: vi.fn(async () => undefined),
      handleTabReplaced: vi.fn(async () => undefined),
    },
    ensureLivenessAlarm: vi.fn(async () => undefined),
    livenessAlarmName: "offscreen-liveness",
    settingsRepository: {
      getSettings: vi.fn(async () => DEFAULT_SETTINGS),
    } as unknown as Pick<SettingsRepository, "getSettings">,
    destinationService: {
      clearDestinationIssuesForTask: vi.fn(async () => undefined),
    } as unknown as DestinationService,
    ...overrides,
  }
}

function createDeferred(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe("registerBackgroundRuntimeListeners", () => {
  const tabsOnReplacedAddListener = vi.fn()
  const downloadsOnChangedAddListener = vi.fn()
  const downloadsOnErasedAddListener = vi.fn()
  const alarmsOnAlarmAddListener = vi.fn()
  const tabsOnRemovedAddListener = vi.fn()
  const runtimeOnUpdateAvailableAddListener = vi.fn()
  const runtimeOnConnectAddListener = vi.fn()
  const storageSessionGet = vi.fn(async () => ({}))
  const storageSessionSet = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    storageSessionGet.mockResolvedValue({})

    vi.stubGlobal("chrome", {
      storage: {
        session: {
          get: storageSessionGet,
          set: storageSessionSet,
        },
      },
      tabs: {
        onReplaced: {
          addListener: tabsOnReplacedAddListener,
        },
        onRemoved: {
          addListener: tabsOnRemovedAddListener,
        },
      },
      downloads: {
        onChanged: {
          addListener: downloadsOnChangedAddListener,
        },
        onErased: {
          addListener: downloadsOnErasedAddListener,
        },
      },
      alarms: {
        onAlarm: {
          addListener: alarmsOnAlarmAddListener,
        },
      },
      runtime: {
        id: "extension-id",
        onUpdateAvailable: {
          addListener: runtimeOnUpdateAvailableAddListener,
        },
        onConnect: {
          addListener: runtimeOnConnectAddListener,
        },
      },
    })
  })

  it("registers every runtime listener synchronously without waiting for readiness", () => {
    const waitForReadiness = vi.fn(() => new Promise<void>(() => undefined))

    registerBackgroundRuntimeListeners(
      createListenerDependencies({ waitForReadiness })
    )

    expect(runtimeOnConnectAddListener).toHaveBeenCalledOnce()
    expect(tabsOnReplacedAddListener).toHaveBeenCalledOnce()
    expect(downloadsOnChangedAddListener).toHaveBeenCalledOnce()
    expect(downloadsOnErasedAddListener).toHaveBeenCalledOnce()
    expect(alarmsOnAlarmAddListener).toHaveBeenCalledOnce()
    expect(tabsOnRemovedAddListener).toHaveBeenCalledOnce()
    expect(runtimeOnUpdateAvailableAddListener).toHaveBeenCalledOnce()
    expect(waitForReadiness).not.toHaveBeenCalled()
  })

  it("surfaces a synchronous failure to install the required Downloads listener", () => {
    downloadsOnChangedAddListener.mockImplementationOnce(() => {
      throw new Error("downloads listener unavailable")
    })

    expect(() =>
      registerBackgroundRuntimeListeners(createListenerDependencies())
    ).toThrow("downloads listener unavailable")
  })

  it("routes only exact sidepanel live-progress Ports after queue hydration", async () => {
    const readiness = createDeferred()
    const waitForReadiness = vi.fn(() => readiness.promise)
    registerBackgroundRuntimeListeners(
      createListenerDependencies({ waitForReadiness })
    )

    const listener = runtimeOnConnectAddListener.mock.calls[0]?.[0] as (
      port: chrome.runtime.Port
    ) => void
    const accepted = {
      name: "tako-active-task-progress",
      sender: {
        id: "extension-id",
        url: "chrome-extension://extension-id/sidepanel.html",
        documentId: "sidepanel-document",
      },
    } as chrome.runtime.Port
    const rejectedDisconnect = vi.fn()

    listener({ name: "another-port" } as chrome.runtime.Port)
    listener({
      name: "tako-active-task-progress",
      sender: { id: "different-extension" },
      disconnect: rejectedDisconnect,
    } as unknown as chrome.runtime.Port)
    listener(accepted)

    expect(waitForReadiness).toHaveBeenCalledExactlyOnceWith("queue-hydrated")
    expect(
      progressPortMocks.registerActiveTaskProgressPort
    ).not.toHaveBeenCalled()

    readiness.resolve()

    await vi.waitFor(() =>
      expect(
        progressPortMocks.registerActiveTaskProgressPort
      ).toHaveBeenCalledOnce()
    )
    expect(
      progressPortMocks.registerActiveTaskProgressPort
    ).toHaveBeenCalledWith(accepted)
    expect(rejectedDisconnect).toHaveBeenCalledOnce()
  })

  it("marks an Options action item when Chrome reports an extension update", async () => {
    registerBackgroundRuntimeListeners(createListenerDependencies())

    const updateAvailableListener = runtimeOnUpdateAvailableAddListener.mock
      .calls[0]?.[0] as (details: chrome.runtime.UpdateAvailableDetails) => void

    updateAvailableListener({ version: "1.2.8" })

    await vi.waitFor(() => {
      expect(storageSessionSet).toHaveBeenCalledWith({
        [SESSION_STORAGE_KEYS.optionsActionItems]: {
          extensionUpdate: expect.objectContaining({
            status: "available",
            version: "1.2.8",
          }),
        },
      })
    })
  })

  it.each(["complete", "interrupted"] as const)(
    "delegates a %s download delta unchanged after exact runtime readiness",
    async (state) => {
      const readiness = createDeferred()
      const waitForReadiness = vi.fn(() => readiness.promise)
      const nativeOutputCoordinator = createNativeOutputCoordinatorStub()
      const ensureLivenessAlarm = vi.fn(async () => undefined)
      registerBackgroundRuntimeListeners(
        createListenerDependencies({
          waitForReadiness,
          nativeOutputCoordinator,
          ensureLivenessAlarm,
        })
      )
      const listener = downloadsOnChangedAddListener.mock.calls[0]?.[0] as (
        delta: chrome.downloads.DownloadDelta
      ) => void
      const delta = {
        id: state === "complete" ? 101 : 102,
        state: { current: state },
        ...(state === "interrupted"
          ? { error: { current: "NETWORK_FAILED" } }
          : {}),
      } as chrome.downloads.DownloadDelta

      listener(delta)

      expect(waitForReadiness).toHaveBeenCalledExactlyOnceWith("runtime-ready")
      expect(
        nativeOutputCoordinator.handleDownloadChanged
      ).not.toHaveBeenCalled()

      readiness.resolve()

      await vi.waitFor(() => {
        expect(
          nativeOutputCoordinator.handleDownloadChanged
        ).toHaveBeenCalledExactlyOnceWith(delta)
      })
      expect(ensureLivenessAlarm).not.toHaveBeenCalled()
    }
  )

  it("ignores in-progress, unrelated, and malformed download changes before readiness", async () => {
    const waitForReadiness = vi.fn(async () => undefined)
    const nativeOutputCoordinator = createNativeOutputCoordinatorStub()
    registerBackgroundRuntimeListeners(
      createListenerDependencies({
        waitForReadiness,
        nativeOutputCoordinator,
      })
    )
    const listener = downloadsOnChangedAddListener.mock.calls[0]?.[0] as (
      delta: chrome.downloads.DownloadDelta
    ) => void

    listener({ id: 201, state: { current: "in_progress" } })
    listener({ id: 202, filename: { current: "unrelated.cbz" } })
    listener({ state: { current: "complete" } } as never)
    listener({ id: "203", state: { current: "complete" } } as never)

    await Promise.resolve()

    expect(waitForReadiness).not.toHaveBeenCalled()
    expect(nativeOutputCoordinator.handleDownloadChanged).not.toHaveBeenCalled()
  })

  it("uses onErased only to notify the coordinator after exact runtime readiness", async () => {
    const readiness = createDeferred()
    const waitForReadiness = vi.fn(() => readiness.promise)
    const nativeOutputCoordinator = createNativeOutputCoordinatorStub()
    const ensureLivenessAlarm = vi.fn(async () => undefined)
    registerBackgroundRuntimeListeners(
      createListenerDependencies({
        waitForReadiness,
        nativeOutputCoordinator,
        ensureLivenessAlarm,
      })
    )
    const listener = downloadsOnErasedAddListener.mock.calls[0]?.[0] as (
      downloadId: number
    ) => void

    listener(404)

    expect(waitForReadiness).toHaveBeenCalledExactlyOnceWith("runtime-ready")
    expect(nativeOutputCoordinator.handleDownloadErased).not.toHaveBeenCalled()

    readiness.resolve()

    await vi.waitFor(() => {
      expect(
        nativeOutputCoordinator.handleDownloadErased
      ).toHaveBeenCalledExactlyOnceWith(404)
    })
    expect(nativeOutputCoordinator.handleDownloadChanged).not.toHaveBeenCalled()
    expect(nativeOutputCoordinator.reconcile).not.toHaveBeenCalled()
    expect(ensureLivenessAlarm).not.toHaveBeenCalled()
  })

  it.each(["changed", "erased"] as const)(
    "keeps reconciliation armed when coordinator handling of a %s event fails",
    async (eventName) => {
      const nativeOutputCoordinator = createNativeOutputCoordinatorStub()
      const coordinatorMethod =
        eventName === "changed"
          ? nativeOutputCoordinator.handleDownloadChanged
          : nativeOutputCoordinator.handleDownloadErased
      vi.mocked(coordinatorMethod).mockRejectedValueOnce(
        new Error("repository unavailable")
      )
      const ensureLivenessAlarm = vi.fn(async () => undefined)
      registerBackgroundRuntimeListeners(
        createListenerDependencies({
          nativeOutputCoordinator,
          ensureLivenessAlarm,
        })
      )

      if (eventName === "changed") {
        const listener = downloadsOnChangedAddListener.mock.calls[0]?.[0] as (
          delta: chrome.downloads.DownloadDelta
        ) => void
        listener({ id: 303, state: { current: "complete" } })
      } else {
        const listener = downloadsOnErasedAddListener.mock.calls[0]?.[0] as (
          downloadId: number
        ) => void
        listener(303)
      }

      await vi.waitFor(() => expect(ensureLivenessAlarm).toHaveBeenCalledOnce())
    }
  )

  it("reconciles native outputs before running liveness recovery on an alarm", async () => {
    const waitForReadiness = vi.fn(async () => undefined)
    const queueRepository = {} as QueueRepository
    const nativeOutputCoordinator = createNativeOutputCoordinatorStub()
    const resumeBlockedQueue = vi.fn(async () => false)
    registerBackgroundRuntimeListeners(
      createListenerDependencies({
        waitForReadiness,
        queueRepository,
        nativeOutputCoordinator,
        providerPolicyQueueCoordinator: {
          resumeBlockedQueue,
        } as unknown as ProviderPolicyQueueCoordinator,
      })
    )
    const alarmListener = alarmsOnAlarmAddListener.mock.calls.at(-1)?.[0] as (
      alarm: chrome.alarms.Alarm
    ) => void

    alarmListener({ name: "offscreen-liveness" } as chrome.alarms.Alarm)

    await vi.waitFor(() => {
      expect(waitForReadiness).toHaveBeenCalledWith("runtime-ready")
      expect(nativeOutputCoordinator.reconcile).toHaveBeenCalledOnce()
      expect(recoveryMocks.recoverFromLivenessTimeout).toHaveBeenCalledWith(
        queueRepository,
        nativeOutputCoordinator,
        expect.any(Object),
        expect.any(Object),
        expect.any(Object)
      )
      expect(
        recoveryMocks.refreshLivenessAlarmForDurableWork
      ).toHaveBeenCalledWith(queueRepository, nativeOutputCoordinator)
    })
    expect(resumeBlockedQueue).toHaveBeenCalledOnce()
    expect(
      vi.mocked(nativeOutputCoordinator.reconcile).mock.invocationCallOrder[0]
    ).toBeLessThan(
      recoveryMocks.recoverFromLivenessTimeout.mock.invocationCallOrder[0]
    )
  })

  it("re-arms the one-shot liveness alarm when runtime initialization fails", async () => {
    const initializationError = new Error("storage unavailable")
    const waitForReadiness = vi.fn(async () => {
      throw initializationError
    })
    const ensureLivenessAlarm = vi.fn(async () => undefined)
    const nativeOutputCoordinator = createNativeOutputCoordinatorStub()
    registerBackgroundRuntimeListeners(
      createListenerDependencies({
        waitForReadiness,
        ensureLivenessAlarm,
        nativeOutputCoordinator,
      })
    )
    const alarmListener = alarmsOnAlarmAddListener.mock.calls.at(-1)?.[0] as (
      alarm: chrome.alarms.Alarm
    ) => void

    alarmListener({ name: "offscreen-liveness" } as chrome.alarms.Alarm)

    await vi.waitFor(() => {
      expect(ensureLivenessAlarm).toHaveBeenCalledOnce()
    })
    expect(nativeOutputCoordinator.reconcile).not.toHaveBeenCalled()
    expect(recoveryMocks.recoverFromLivenessTimeout).not.toHaveBeenCalled()
  })

  it("keeps provider continuation repair armed after durable-work refresh", async () => {
    const ensureLivenessAlarm = vi.fn(async () => undefined)
    const resumeBlockedQueue = vi.fn(async () => {
      throw new Error("queue accounting unavailable")
    })
    registerBackgroundRuntimeListeners(
      createListenerDependencies({
        ensureLivenessAlarm,
        providerPolicyQueueCoordinator: {
          resumeBlockedQueue,
        } as unknown as ProviderPolicyQueueCoordinator,
      })
    )
    const alarmListener = alarmsOnAlarmAddListener.mock.calls.at(-1)?.[0] as (
      alarm: chrome.alarms.Alarm
    ) => void

    alarmListener({ name: "offscreen-liveness" } as chrome.alarms.Alarm)

    await vi.waitFor(() => {
      expect(
        recoveryMocks.refreshLivenessAlarmForDurableWork
      ).toHaveBeenCalledOnce()
      expect(ensureLivenessAlarm).toHaveBeenCalled()
    })
    const refreshOrder =
      recoveryMocks.refreshLivenessAlarmForDurableWork.mock
        .invocationCallOrder[0]
    const finalEnsureOrder = ensureLivenessAlarm.mock.invocationCallOrder.at(-1)
    expect(finalEnsureOrder).toBeGreaterThan(refreshOrder)
  })

  it("routes a persisted Undo alarm without running liveness recovery", async () => {
    const waitForReadiness = vi.fn(async () => undefined)
    const queueRepository = {} as QueueRepository
    const nativeOutputCoordinator = createNativeOutputCoordinatorStub()
    registerBackgroundRuntimeListeners(
      createListenerDependencies({
        waitForReadiness,
        queueRepository,
        nativeOutputCoordinator,
      })
    )
    const alarmListener = alarmsOnAlarmAddListener.mock.calls.at(-1)?.[0] as (
      alarm: chrome.alarms.Alarm
    ) => void

    alarmListener({ name: "pending-undo:undo-123" } as chrome.alarms.Alarm)

    await vi.waitFor(() => {
      expect(waitForReadiness).toHaveBeenCalledWith("runtime-ready")
      expect(
        pendingUndoMocks.finalizePendingUndoAndCleanup
      ).toHaveBeenCalledWith(queueRepository, "undo-123", expect.any(Object))
    })
    expect(nativeOutputCoordinator.reconcile).not.toHaveBeenCalled()
    expect(recoveryMocks.recoverFromLivenessTimeout).not.toHaveBeenCalled()
  })
})
