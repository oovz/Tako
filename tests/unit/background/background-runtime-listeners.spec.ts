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
  reconcileAllPendingOutputs: vi.fn(async () => undefined),
  recoverFromLivenessTimeout: vi.fn(async () => undefined),
}))
const pendingUndoMocks = vi.hoisted(() => ({
  finalizePendingUndoAndCleanup: vi.fn(async () => undefined),
}))
const progressPortMocks = vi.hoisted(() => ({
  registerActiveTaskProgressPort: vi.fn(),
}))

vi.mock(
  "@/entrypoints/background/native-output-finalizer",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/entrypoints/background/native-output-finalizer")
      >()
    return {
      ...actual,
      reconcileAllPendingOutputs: recoveryMocks.reconcileAllPendingOutputs,
    }
  }
)

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

vi.mock(
  "@/entrypoints/background/offscreen-lifecycle",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/entrypoints/background/offscreen-lifecycle")
      >()
    return {
      ...actual,
      recoverFromLivenessTimeout: recoveryMocks.recoverFromLivenessTimeout,
    }
  }
)

import { registerBackgroundRuntimeListeners } from "@/entrypoints/background/background-runtime-listeners"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import {
  createPendingDownloadsStoreStub,
  createPendingOutputRecord,
} from "./pending-output-test-helpers"

describe("registerBackgroundRuntimeListeners", () => {
  const tabsOnReplacedAddListener = vi.fn()
  const downloadsOnChangedAddListener = vi.fn()
  const alarmsOnAlarmAddListener = vi.fn()
  const tabsOnRemovedAddListener = vi.fn()
  const runtimeOnUpdateAvailableAddListener = vi.fn()
  const runtimeOnSuspendAddListener = vi.fn()
  const runtimeOnConnectAddListener = vi.fn()
  const runtimeGetContexts = vi.fn(async () => [{}])
  const runtimeSendMessage = vi.fn(async () => ({
    success: true,
    isInitialized: true,
    activeJobCount: 0,
    activeTaskIds: [],
  }))
  const closeDocument = vi.fn(async () => undefined)
  const storageSessionGet = vi.fn(async () => ({}))
  const storageSessionSet = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    storageSessionGet.mockResolvedValue({})

    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
        },
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
      },
      alarms: {
        onAlarm: {
          addListener: alarmsOnAlarmAddListener,
        },
      },
      runtime: {
        id: "extension-id",
        getURL: vi.fn(() => "chrome-extension://test/offscreen.html"),
        getContexts: runtimeGetContexts,
        sendMessage: runtimeSendMessage,
        onUpdateAvailable: {
          addListener: runtimeOnUpdateAvailableAddListener,
        },
        onSuspend: {
          addListener: runtimeOnSuspendAddListener,
        },
        onConnect: {
          addListener: runtimeOnConnectAddListener,
        },
      },
      offscreen: {
        hasDocument: vi.fn(async () => true),
        closeDocument,
      },
    })
  })

  it("fails registration when the required Downloads listener cannot be installed", () => {
    downloadsOnChangedAddListener.mockImplementationOnce(() => {
      throw new Error("downloads listener unavailable")
    })

    expect(() =>
      registerBackgroundRuntimeListeners({
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        isStateManagerReady: () => true,
        getStateManager: vi.fn() as never,
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
        tabContextCache: {
          handleTabRemoved: vi.fn(async () => undefined),
          handleTabReplaced: vi.fn(async () => undefined),
        },
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        ensureLivenessAlarm: vi.fn(async () => undefined),
        livenessAlarmName: "offscreen-liveness",
      })
    ).toThrow("downloads listener unavailable")
  })

  it("routes only internal live-progress Ports to the progress bus", () => {
    registerBackgroundRuntimeListeners({
      ensureStateManagerInitialized: vi.fn(async () => undefined),
      isStateManagerReady: () => true,
      getStateManager: vi.fn() as never,
      pendingDownloadsStore: createPendingDownloadsStoreStub(),
      requestBlobRevocation: vi.fn(async () => undefined),
      tabContextCache: {
        handleTabRemoved: vi.fn(async () => undefined),
        handleTabReplaced: vi.fn(async () => undefined),
      },
      ensureOffscreenDocumentReady: vi.fn(async () => undefined),
      ensureLivenessAlarm: vi.fn(async () => undefined),
      livenessAlarmName: "offscreen-liveness",
    })

    const listener = runtimeOnConnectAddListener.mock.calls[0]?.[0] as (
      port: chrome.runtime.Port
    ) => void
    const accepted = {
      name: "tako-active-task-progress",
      sender: { id: "extension-id" },
    } as chrome.runtime.Port
    listener({ name: "another-port" } as chrome.runtime.Port)
    listener({
      name: "tako-active-task-progress",
      sender: { id: "different-extension" },
    } as chrome.runtime.Port)
    listener(accepted)

    expect(
      progressPortMocks.registerActiveTaskProgressPort
    ).toHaveBeenCalledOnce()
    expect(
      progressPortMocks.registerActiveTaskProgressPort
    ).toHaveBeenCalledWith(accepted)
  })

  it("marks an Options action item when Chrome reports an extension update is available", async () => {
    registerBackgroundRuntimeListeners({
      ensureStateManagerInitialized: vi.fn(async () => undefined),
      isStateManagerReady: () => true,
      getStateManager: vi.fn() as never,
      pendingDownloadsStore: createPendingDownloadsStoreStub(),
      requestBlobRevocation: vi.fn(async () => undefined),
      tabContextCache: {
        handleTabRemoved: vi.fn(async () => undefined),
        handleTabReplaced: vi.fn(async () => undefined),
      },
      ensureOffscreenDocumentReady: vi.fn(async () => undefined),
      ensureLivenessAlarm: vi.fn(async () => undefined),
      livenessAlarmName: "offscreen-liveness",
    })

    const updateAvailableListener = runtimeOnUpdateAvailableAddListener.mock
      .calls[0]?.[0] as (details: chrome.runtime.UpdateAvailableDetails) => void

    updateAvailableListener({ version: "1.2.8" })
    await Promise.resolve()
    await Promise.resolve()

    expect(storageSessionSet).toHaveBeenCalledWith({
      [SESSION_STORAGE_KEYS.optionsActionItems]: {
        extensionUpdate: expect.objectContaining({
          status: "available",
          version: "1.2.8",
        }),
      },
    })
  })

  it("hydrates persisted outputs before committing and revoking terminal Blob URLs", async () => {
    const ensureStateManagerInitialized = vi.fn(async () => undefined)
    const record = createPendingOutputRecord({
      downloadId: 101,
      blobUrl: "blob:tracked-download",
    })
    const pendingDownloadsStore = createPendingDownloadsStoreStub([record])
    pendingDownloadsStore.get
      .mockReturnValueOnce(undefined)
      .mockReturnValue(record)
    const updateDownloadTask = vi.fn(async () => undefined)
    const requestBlobRevocation = vi.fn(async () => undefined)

    registerBackgroundRuntimeListeners({
      ensureStateManagerInitialized,
      isStateManagerReady: () => false,
      getStateManager: () => ({ updateDownloadTask }) as never,
      pendingDownloadsStore,
      requestBlobRevocation,
      tabContextCache: {
        handleTabRemoved: vi.fn(async () => undefined),
        handleTabReplaced: vi.fn(async () => undefined),
      },
      ensureOffscreenDocumentReady: vi.fn(async () => undefined),
      ensureLivenessAlarm: vi.fn(async () => undefined),
      livenessAlarmName: "offscreen-liveness",
    })

    const downloadListener = downloadsOnChangedAddListener.mock
      .calls[0]?.[0] as (delta: {
      id?: number
      state?: { current?: string }
    }) => void

    downloadListener({
      id: 101,
      state: { current: "complete" },
    })

    await vi.waitFor(() => {
      expect(ensureStateManagerInitialized).toHaveBeenCalledTimes(1)
      expect(pendingDownloadsStore.hydrate).toHaveBeenCalledTimes(1)
      expect(pendingDownloadsStore.get).toHaveBeenNthCalledWith(1, 101)
      expect(pendingDownloadsStore.get).toHaveBeenNthCalledWith(2, 101)
      expect(pendingDownloadsStore.markTerminal).toHaveBeenCalledWith(
        101,
        "complete",
        undefined
      )
      expect(updateDownloadTask).toHaveBeenCalledWith("task-1", {
        lastSuccessfulDownloadId: 101,
      })
      expect(requestBlobRevocation).toHaveBeenCalledWith(
        expect.objectContaining({
          outputId: "job-1:archive:0",
          blobUrl: "blob:tracked-download",
        })
      )
    })
    await vi.waitFor(() => {
      expect(closeDocument).toHaveBeenCalledTimes(1)
    })
  })

  it("does not close an idle offscreen document on suspend while a task is active", async () => {
    registerBackgroundRuntimeListeners({
      ensureStateManagerInitialized: vi.fn(async () => undefined),
      isStateManagerReady: () => true,
      getStateManager: () =>
        ({
          getGlobalState: vi.fn(async () => ({
            downloadQueue: [{ id: "active", status: "downloading" }],
          })),
        }) as never,
      pendingDownloadsStore: createPendingDownloadsStoreStub(),
      requestBlobRevocation: vi.fn(async () => undefined),
      tabContextCache: {
        handleTabRemoved: vi.fn(async () => undefined),
        handleTabReplaced: vi.fn(async () => undefined),
      },
      ensureOffscreenDocumentReady: vi.fn(async () => undefined),
      ensureLivenessAlarm: vi.fn(async () => undefined),
      livenessAlarmName: "offscreen-liveness",
    })

    const suspendListener = runtimeOnSuspendAddListener.mock.calls.at(
      -1
    )?.[0] as (() => void) | undefined
    suspendListener?.()
    await Promise.resolve()
    await Promise.resolve()

    expect(closeDocument).not.toHaveBeenCalled()
  })

  it("uses the in-memory pending output before hydrating its durable backup", async () => {
    const ensureStateManagerInitialized = vi.fn(async () => undefined)
    const pendingDownloadsStore = createPendingDownloadsStoreStub([
      createPendingOutputRecord({
        downloadId: 202,
        blobUrl: "blob:in-memory-download",
      }),
    ])
    const updateDownloadTask = vi.fn(async () => undefined)
    const requestBlobRevocation = vi.fn(async () => undefined)

    registerBackgroundRuntimeListeners({
      ensureStateManagerInitialized,
      isStateManagerReady: () => false,
      getStateManager: () => ({ updateDownloadTask }) as never,
      pendingDownloadsStore,
      requestBlobRevocation,
      tabContextCache: {
        handleTabRemoved: vi.fn(async () => undefined),
        handleTabReplaced: vi.fn(async () => undefined),
      },
      ensureOffscreenDocumentReady: vi.fn(async () => undefined),
      ensureLivenessAlarm: vi.fn(async () => undefined),
      livenessAlarmName: "offscreen-liveness",
    })

    const downloadListener = downloadsOnChangedAddListener.mock
      .calls[0]?.[0] as (delta: {
      id?: number
      state?: { current?: string }
    }) => void

    downloadListener({
      id: 202,
      state: { current: "complete" },
    })

    await vi.waitFor(() => {
      expect(ensureStateManagerInitialized).toHaveBeenCalledTimes(1)
      expect(pendingDownloadsStore.hydrate).not.toHaveBeenCalled()
      expect(pendingDownloadsStore.get).toHaveBeenCalledWith(202)
      expect(pendingDownloadsStore.markTerminal).toHaveBeenCalledWith(
        202,
        "complete",
        undefined
      )
      expect(requestBlobRevocation).toHaveBeenCalledWith(
        expect.objectContaining({ blobUrl: "blob:in-memory-download" })
      )
    })
  })

  it("reconciles ambiguous outputs before running liveness recovery on an alarm", async () => {
    const ensureStateManagerInitialized = vi.fn(async () => undefined)
    const stateManager = {} as never
    const pendingDownloadsStore = createPendingDownloadsStoreStub()

    registerBackgroundRuntimeListeners({
      ensureStateManagerInitialized,
      isStateManagerReady: () => true,
      getStateManager: () => stateManager,
      pendingDownloadsStore,
      requestBlobRevocation: vi.fn(async () => undefined),
      tabContextCache: {
        handleTabRemoved: vi.fn(async () => undefined),
        handleTabReplaced: vi.fn(async () => undefined),
      },
      ensureOffscreenDocumentReady: vi.fn(async () => undefined),
      ensureLivenessAlarm: vi.fn(async () => undefined),
      livenessAlarmName: "offscreen-liveness",
    })

    const alarmListener = alarmsOnAlarmAddListener.mock.calls.at(-1)?.[0] as (
      alarm: chrome.alarms.Alarm
    ) => void
    alarmListener({ name: "offscreen-liveness" } as chrome.alarms.Alarm)

    await vi.waitFor(() => {
      expect(ensureStateManagerInitialized).toHaveBeenCalledTimes(1)
      expect(recoveryMocks.reconcileAllPendingOutputs).toHaveBeenCalledWith(
        expect.objectContaining({
          stateManager,
          pendingOutputs: pendingDownloadsStore,
        })
      )
      expect(recoveryMocks.recoverFromLivenessTimeout).toHaveBeenCalledTimes(1)
    })
    expect(
      recoveryMocks.reconcileAllPendingOutputs.mock.invocationCallOrder[0]
    ).toBeLessThan(
      recoveryMocks.recoverFromLivenessTimeout.mock.invocationCallOrder[0]
    )
  })

  it("re-arms the one-shot liveness alarm when runtime initialization fails", async () => {
    const initializationError = new Error("storage unavailable")
    const ensureStateManagerInitialized = vi.fn(async () => {
      throw initializationError
    })
    const ensureLivenessAlarm = vi.fn(async () => undefined)

    registerBackgroundRuntimeListeners({
      ensureStateManagerInitialized,
      isStateManagerReady: () => false,
      getStateManager: vi.fn() as never,
      pendingDownloadsStore: createPendingDownloadsStoreStub(),
      requestBlobRevocation: vi.fn(async () => undefined),
      tabContextCache: {
        handleTabRemoved: vi.fn(async () => undefined),
        handleTabReplaced: vi.fn(async () => undefined),
      },
      ensureOffscreenDocumentReady: vi.fn(async () => undefined),
      ensureLivenessAlarm,
      livenessAlarmName: "offscreen-liveness",
    })

    const alarmListener = alarmsOnAlarmAddListener.mock.calls.at(-1)?.[0] as (
      alarm: chrome.alarms.Alarm
    ) => void
    alarmListener({ name: "offscreen-liveness" } as chrome.alarms.Alarm)

    await vi.waitFor(() => {
      expect(ensureLivenessAlarm).toHaveBeenCalledTimes(1)
    })
    expect(recoveryMocks.reconcileAllPendingOutputs).not.toHaveBeenCalled()
    expect(recoveryMocks.recoverFromLivenessTimeout).not.toHaveBeenCalled()
  })

  it("routes a persisted Undo alarm without running liveness recovery", async () => {
    const ensureStateManagerInitialized = vi.fn(async () => undefined)
    const stateManager = {} as never

    registerBackgroundRuntimeListeners({
      ensureStateManagerInitialized,
      isStateManagerReady: () => true,
      getStateManager: () => stateManager,
      pendingDownloadsStore: createPendingDownloadsStoreStub(),
      requestBlobRevocation: vi.fn(async () => undefined),
      tabContextCache: {
        handleTabRemoved: vi.fn(async () => undefined),
        handleTabReplaced: vi.fn(async () => undefined),
      },
      ensureOffscreenDocumentReady: vi.fn(async () => undefined),
      ensureLivenessAlarm: vi.fn(async () => undefined),
      livenessAlarmName: "offscreen-liveness",
    })

    const alarmListener = alarmsOnAlarmAddListener.mock.calls.at(-1)?.[0] as (
      alarm: chrome.alarms.Alarm
    ) => void
    alarmListener({ name: "pending-undo:undo-123" } as chrome.alarms.Alarm)

    await vi.waitFor(() => {
      expect(
        pendingUndoMocks.finalizePendingUndoAndCleanup
      ).toHaveBeenCalledWith(stateManager, "undo-123")
    })
    expect(recoveryMocks.recoverFromLivenessTimeout).not.toHaveBeenCalled()
  })
})
