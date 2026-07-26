import { beforeEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_SETTINGS } from "@/src/storage/default-settings"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import type {
  DownloadTaskState,
  PendingOutputRecord,
} from "@/src/types/queue-state"
import {
  createPendingDownloadsStoreStub as createBasePendingDownloadsStoreStub,
  createPendingOutputRecord,
} from "./pending-output-test-helpers"

interface StartupRecoveryDependencies {
  readQueue: () => Promise<DownloadTaskState[]>
  writeQueue: (queue: DownloadTaskState[]) => Promise<void>
  writeSession: (values: Record<string, unknown>) => Promise<void>
  applyQueue: (queue: DownloadTaskState[]) => Promise<void>
  getOffscreenContexts: () => Promise<unknown[]>
  getOffscreenActiveTaskIds: () => Promise<string[]>
  ensureLivenessAlarm: () => Promise<void>
}

const mocks = vi.hoisted(() => ({
  initializeBackgroundSiteIntegrations: vi.fn(async () => undefined),
  getSettings: vi.fn(async () => ({ downloads: { defaultFormat: "cbz" } })),
  settingsSyncInitialize: vi.fn(),
  createStateManager: vi.fn(),
  initializeFromStorage: vi.fn<
    (dependencies: StartupRecoveryDependencies) => Promise<{
      queue: DownloadTaskState[]
      initFailed: boolean
      queueActivation?:
        { kind: "process-queue" } | { kind: "resume-task"; taskId: string }
      error?: string
    }>
  >(async () => ({ queue: [], initFailed: false })),
  processDownloadQueue: vi.fn(async () => undefined),
  resumeDownloadTask: vi.fn(async () => undefined),
  hydratePendingDownloads: vi.fn(async () => undefined),
  updateGlobalState: vi.fn(async () => undefined),
  reconcileExpiredPendingUndoActions: vi.fn(async () => ({
    finalized: [],
    pending: [],
  })),
  reconcileCompletedChapterHistory: vi.fn(async () => undefined),
  loggerWarn: vi.fn(),
  storageLocalGet: vi.fn<(key: string) => Promise<Record<string, unknown>>>(
    async () => ({ downloadQueue: [] })
  ),
  storageLocalSet: vi.fn(async () => undefined),
  storageSessionSet: vi.fn(async () => undefined),
  getOffscreenContexts: vi.fn(async () => [] as unknown[]),
  hasOffscreenDocument: vi.fn(async () => false),
  queryOffscreenJob: vi.fn(async () => null),
  queryOffscreenStatus: vi.fn(
    async () =>
      ({
        ready: true,
        activeJobCount: 0,
        activeTaskIds: [],
      }) as {
        ready: boolean
        activeJobCount: number
        activeTaskIds: string[]
      } | null
  ),
  applyUiLanguagePreference: vi.fn(async () => undefined),
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock("@/src/runtime/i18n", () => ({
  applyUiLanguagePreference: mocks.applyUiLanguagePreference,
}))

vi.mock("@/src/runtime/background-site-integration-initialization", () => ({
  initializeBackgroundSiteIntegrations:
    mocks.initializeBackgroundSiteIntegrations,
}))

vi.mock("@/src/storage/settings-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/src/storage/settings-service")>()
  return {
    ...actual,
    settingsService: {
      getSettings: mocks.getSettings,
    },
  }
})

vi.mock("@/src/storage/settings-sync-service", () => ({
  settingsSyncService: {
    initialize: mocks.settingsSyncInitialize,
  },
}))

vi.mock("@/entrypoints/background/state-action-router", () => ({
  createStateManager: mocks.createStateManager,
}))

vi.mock("@/entrypoints/background/initialize-from-storage", () => ({
  initializeFromStorage: mocks.initializeFromStorage,
}))

vi.mock("@/entrypoints/background/download-queue", () => ({
  processDownloadQueue: mocks.processDownloadQueue,
  resumeDownloadTask: mocks.resumeDownloadTask,
}))

vi.mock("@/entrypoints/background/download-queue-finalization", () => ({
  reconcileCompletedChapterHistory: mocks.reconcileCompletedChapterHistory,
}))

vi.mock("@/entrypoints/background/offscreen-lifecycle", () => ({
  getOffscreenContexts: mocks.getOffscreenContexts,
  hasOffscreenDocument: mocks.hasOffscreenDocument,
  queryOffscreenJob: mocks.queryOffscreenJob,
  queryOffscreenStatus: mocks.queryOffscreenStatus,
}))

function createPendingDownloadsStoreStub(
  seed: readonly PendingOutputRecord[] = []
) {
  const store = createBasePendingDownloadsStoreStub(seed)
  store.hydrate.mockImplementation(mocks.hydratePendingDownloads)
  return store
}

describe("initializeBackgroundRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.initializeBackgroundSiteIntegrations.mockResolvedValue(undefined)
    mocks.getSettings.mockResolvedValue({
      downloads: { defaultFormat: "cbz" },
    })
    mocks.initializeFromStorage.mockResolvedValue({
      queue: [],
      initFailed: false,
    })
    mocks.processDownloadQueue.mockResolvedValue(undefined)
    mocks.resumeDownloadTask.mockResolvedValue(undefined)
    mocks.hydratePendingDownloads.mockResolvedValue(undefined)
    mocks.updateGlobalState.mockResolvedValue(undefined)
    mocks.reconcileExpiredPendingUndoActions.mockResolvedValue({
      finalized: [],
      pending: [],
    })
    mocks.reconcileCompletedChapterHistory.mockResolvedValue(undefined)
    mocks.storageLocalGet.mockResolvedValue({ downloadQueue: [] })
    mocks.storageLocalSet.mockResolvedValue(undefined)
    mocks.storageSessionSet.mockResolvedValue(undefined)
    mocks.getOffscreenContexts.mockResolvedValue([])
    mocks.hasOffscreenDocument.mockResolvedValue(false)
    mocks.queryOffscreenJob.mockResolvedValue(null)
    mocks.queryOffscreenStatus.mockResolvedValue({
      ready: true,
      activeJobCount: 0,
      activeTaskIds: [],
    })

    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: mocks.storageLocalGet,
          set: mocks.storageLocalSet,
        },
        session: {
          set: mocks.storageSessionSet,
        },
      },
    })

    mocks.createStateManager.mockResolvedValue({
      updateGlobalState: mocks.updateGlobalState,
      reconcileExpiredPendingUndoActions:
        mocks.reconcileExpiredPendingUndoActions,
    } satisfies Pick<
      CentralizedStateManager,
      "updateGlobalState" | "reconcileExpiredPendingUndoActions"
    >)
  })

  it("does not eagerly validate custom folder access during startup", async () => {
    const { initializeBackgroundRuntime } =
      await import("@/entrypoints/background/background-startup")

    const pendingDownloadsStore = createPendingDownloadsStoreStub()

    await initializeBackgroundRuntime({
      pendingDownloadsStore,
      ensureLivenessAlarm: async () => undefined,
      ensureOffscreenDocumentReady: async () => undefined,
      requestBlobRevocation: vi.fn(async () => undefined),
    })

    expect(mocks.settingsSyncInitialize).toHaveBeenCalledTimes(1)
  })

  it("returns the initialized state manager before slow recovery completes", async () => {
    const { beginBackgroundRuntimeInitialization } =
      await import("@/entrypoints/background/background-startup")
    let releaseHydration: (() => void) | undefined
    mocks.hydratePendingDownloads.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseHydration = () => resolve(undefined)
        })
    )
    const startup = await beginBackgroundRuntimeInitialization({
      pendingDownloadsStore: createPendingDownloadsStoreStub(),
      ensureLivenessAlarm: async () => undefined,
      ensureOffscreenDocumentReady: async () => undefined,
      requestBlobRevocation: vi.fn(async () => undefined),
    })

    expect(startup.stateManager).toBeDefined()
    await vi.waitFor(() =>
      expect(mocks.hydratePendingDownloads).toHaveBeenCalledTimes(1)
    )

    releaseHydration?.()
    await expect(startup.initialized).resolves.toBeDefined()
  })

  it("releases terminal pending-output records after their accounting is durable", async () => {
    const { initializeBackgroundRuntime } =
      await import("@/entrypoints/background/background-startup")
    const pendingDownloadsStore = createPendingDownloadsStoreStub([
      createPendingOutputRecord({
        state: "complete",
        terminalAt: 2_000,
        blobRevokedAt: 2_001,
      }),
    ])

    await initializeBackgroundRuntime({
      pendingDownloadsStore,
      ensureLivenessAlarm: async () => undefined,
      ensureOffscreenDocumentReady: async () => undefined,
      requestBlobRevocation: vi.fn(async () => undefined),
    })

    expect(pendingDownloadsStore.releaseJob).toHaveBeenCalledWith("job-1")
    expect(pendingDownloadsStore.snapshot().size).toBe(0)
  })

  it("continues startup without redownloading when native status lookup is transiently unavailable", async () => {
    const { initializeBackgroundRuntime } =
      await import("@/entrypoints/background/background-startup")
    const pendingRecord = createPendingOutputRecord({
      state: "in_progress",
      downloadId: 42,
    })
    const pendingDownloadsStore = createPendingDownloadsStoreStub([
      pendingRecord,
    ])
    const download = vi.fn()
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: mocks.storageLocalGet,
          set: mocks.storageLocalSet,
        },
        session: {
          set: mocks.storageSessionSet,
        },
      },
      downloads: {
        search: vi.fn(async () => {
          throw new Error("downloads database temporarily unavailable")
        }),
        download,
      },
    })

    await expect(
      initializeBackgroundRuntime({
        pendingDownloadsStore,
        ensureLivenessAlarm: async () => undefined,
        ensureOffscreenDocumentReady: async () => undefined,
        requestBlobRevocation: vi.fn(async () => undefined),
      })
    ).resolves.toBeDefined()

    expect(download).not.toHaveBeenCalled()
    expect(pendingDownloadsStore.getByOutputId(pendingRecord.outputId)).toEqual(
      pendingRecord
    )
    expect(pendingDownloadsStore.releaseJob).not.toHaveBeenCalled()
  })

  it("rejects malformed persisted queue entries before startup recovery", async () => {
    mocks.storageLocalGet.mockResolvedValue({
      downloadQueue: [
        {
          id: "task-legacy",
          siteIntegrationId: "test-site",
          mangaId: "series-1",
          seriesTitle: "Legacy Series",
          created: 1,
          status: "queued",
          chapters: [
            {
              id: "ch-1",
              url: "https://example.com/ch-1",
              title: "Chapter 1",
              status: "queued",
              index: 0,
              lastUpdated: 1,
            },
          ],
          settingsSnapshot: {
            archiveFormat: "rar",
            overwriteExisting: "yes",
            pathTemplate: "",
            fileNameTemplate: "",
            includeComicInfo: "true",
            includeCoverImage: 1,
          },
        },
        {
          invalid: true,
        },
      ],
    })

    mocks.initializeFromStorage.mockImplementationOnce(
      async (dependencies: {
        readQueue: () => Promise<DownloadTaskState[]>
      }) => {
        const { readQueue } = dependencies
        const queue = await readQueue()

        expect(queue).toEqual([])

        return { queue, initFailed: false }
      }
    )

    const { initializeBackgroundRuntime } =
      await import("@/entrypoints/background/background-startup")

    const pendingDownloadsStore = createPendingDownloadsStoreStub()

    await initializeBackgroundRuntime({
      pendingDownloadsStore,
      ensureLivenessAlarm: async () => undefined,
      ensureOffscreenDocumentReady: async () => undefined,
      requestBlobRevocation: vi.fn(async () => undefined),
    })
  })

  it("hydrates services, applies settings, and returns an inert queue activator with the state manager", async () => {
    const stateManager = {
      updateGlobalState: mocks.updateGlobalState,
      reconcileExpiredPendingUndoActions:
        mocks.reconcileExpiredPendingUndoActions,
    } as unknown as CentralizedStateManager
    mocks.createStateManager.mockResolvedValueOnce(stateManager)
    const { initializeBackgroundRuntime } =
      await import("@/entrypoints/background/background-startup")

    const result = await initializeBackgroundRuntime({
      pendingDownloadsStore: createPendingDownloadsStoreStub(),
      ensureLivenessAlarm: async () => undefined,
      ensureOffscreenDocumentReady: async () => undefined,
      requestBlobRevocation: vi.fn(async () => undefined),
    })

    expect(result.stateManager).toBe(stateManager)
    await expect(result.activateQueue()).resolves.toBeUndefined()
    expect(mocks.settingsSyncInitialize).toHaveBeenCalledTimes(1)
    expect(mocks.hydratePendingDownloads).toHaveBeenCalledTimes(1)
    expect(mocks.initializeBackgroundSiteIntegrations).toHaveBeenCalledTimes(1)
    expect(mocks.updateGlobalState).toHaveBeenCalledWith({
      settings: { downloads: { defaultFormat: "cbz" } },
    })
  })

  it("keeps runtime startup available when downloaded-history repair fails", async () => {
    mocks.reconcileCompletedChapterHistory.mockRejectedValueOnce(
      new Error("history storage unavailable")
    )
    const { initializeBackgroundRuntime } =
      await import("@/entrypoints/background/background-startup")

    await expect(
      initializeBackgroundRuntime({
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        ensureLivenessAlarm: async () => undefined,
        ensureOffscreenDocumentReady: async () => undefined,
        requestBlobRevocation: vi.fn(async () => undefined),
      })
    ).resolves.toBeDefined()

    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      "Failed to reconcile completed chapter history during startup:",
      expect.objectContaining({ message: "history storage unavailable" })
    )
  })

  it("applies the persisted UI language during service-worker startup", async () => {
    const settings = { ...DEFAULT_SETTINGS, uiLanguage: "ja" as const }
    mocks.getSettings.mockResolvedValueOnce(settings)
    const { initializeBackgroundRuntime } =
      await import("@/entrypoints/background/background-startup")

    await initializeBackgroundRuntime({
      pendingDownloadsStore: createPendingDownloadsStoreStub(),
      ensureLivenessAlarm: async () => undefined,
      ensureOffscreenDocumentReady: async () => undefined,
      requestBlobRevocation: vi.fn(async () => undefined),
    })

    expect(mocks.applyUiLanguagePreference).toHaveBeenCalledWith("ja")
  })

  it("fails closed when site integration initialization fails", async () => {
    mocks.initializeBackgroundSiteIntegrations.mockRejectedValueOnce(
      new Error("integration load failed")
    )
    const { initializeBackgroundRuntime } =
      await import("@/entrypoints/background/background-startup")

    await expect(
      initializeBackgroundRuntime({
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        ensureLivenessAlarm: async () => undefined,
        ensureOffscreenDocumentReady: async () => undefined,
        requestBlobRevocation: vi.fn(async () => undefined),
      })
    ).rejects.toThrow("integration load failed")
  })

  it("continues when settings synchronization fails", async () => {
    mocks.getSettings.mockRejectedValueOnce(new Error("settings unavailable"))
    const { initializeBackgroundRuntime } =
      await import("@/entrypoints/background/background-startup")

    await expect(
      initializeBackgroundRuntime({
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        ensureLivenessAlarm: async () => undefined,
        ensureOffscreenDocumentReady: async () => undefined,
        requestBlobRevocation: vi.fn(async () => undefined),
      })
    ).resolves.toBeDefined()

    expect(mocks.initializeFromStorage).toHaveBeenCalledTimes(1)
    expect(mocks.updateGlobalState).not.toHaveBeenCalled()
  })

  it("exposes startup recovery dependencies and defers queue processing until activation", async () => {
    const ensureLivenessAlarm = vi.fn(async () => undefined)
    const ensureOffscreenDocumentReady = vi.fn(async () => undefined)
    mocks.initializeFromStorage.mockImplementationOnce(async (dependencies) => {
      const queue = await dependencies.readQueue()
      await dependencies.writeQueue(queue)
      await dependencies.writeSession({ startup: "ready" })
      await dependencies.applyQueue(queue)
      await dependencies.ensureLivenessAlarm()
      expect(await dependencies.getOffscreenContexts()).toEqual([])
      expect(await dependencies.getOffscreenActiveTaskIds()).toEqual([])
      return {
        queue,
        initFailed: false,
        queueActivation: { kind: "process-queue" },
      }
    })
    const { initializeBackgroundRuntime } =
      await import("@/entrypoints/background/background-startup")

    const initializedRuntime = await initializeBackgroundRuntime({
      pendingDownloadsStore: createPendingDownloadsStoreStub(),
      ensureLivenessAlarm,
      ensureOffscreenDocumentReady,
      requestBlobRevocation: vi.fn(async () => undefined),
    })

    expect(mocks.storageLocalSet).toHaveBeenCalledWith({ downloadQueue: [] })
    expect(mocks.storageSessionSet).toHaveBeenCalledWith({ startup: "ready" })
    expect(mocks.updateGlobalState).toHaveBeenCalledWith({ downloadQueue: [] })
    expect(ensureLivenessAlarm).toHaveBeenCalledTimes(1)
    expect(mocks.processDownloadQueue).not.toHaveBeenCalled()

    await initializedRuntime.activateQueue()

    expect(mocks.processDownloadQueue).toHaveBeenCalledWith(
      expect.anything(),
      ensureOffscreenDocumentReady
    )
    await initializedRuntime.activateQueue()
    expect(mocks.processDownloadQueue).toHaveBeenCalledTimes(1)
  })

  it("defers exact active-task resumption until the caller exposes the state manager", async () => {
    mocks.initializeFromStorage.mockResolvedValueOnce({
      queue: [],
      initFailed: false,
      queueActivation: { kind: "resume-task", taskId: "active-task" },
    })
    const ensureOffscreenDocumentReady = vi.fn(async () => undefined)
    const { initializeBackgroundRuntime } =
      await import("@/entrypoints/background/background-startup")

    const initializedRuntime = await initializeBackgroundRuntime({
      pendingDownloadsStore: createPendingDownloadsStoreStub(),
      ensureLivenessAlarm: async () => undefined,
      ensureOffscreenDocumentReady,
      requestBlobRevocation: vi.fn(async () => undefined),
    })

    expect(mocks.resumeDownloadTask).not.toHaveBeenCalled()
    await initializedRuntime.activateQueue()
    expect(mocks.resumeDownloadTask).toHaveBeenCalledWith(
      initializedRuntime.stateManager,
      "active-task",
      ensureOffscreenDocumentReady
    )
  })

  it("fails closed when an existing offscreen document returns malformed identity status", async () => {
    mocks.queryOffscreenStatus.mockResolvedValueOnce(null)
    mocks.getOffscreenContexts.mockResolvedValueOnce([{}])
    mocks.initializeFromStorage.mockImplementationOnce(async (dependencies) => {
      try {
        await dependencies.getOffscreenActiveTaskIds()
        return { queue: [], initFailed: false }
      } catch (error) {
        return {
          queue: [],
          initFailed: true,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })
    const { initializeBackgroundRuntime } =
      await import("@/entrypoints/background/background-startup")

    await expect(
      initializeBackgroundRuntime({
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        ensureLivenessAlarm: async () => undefined,
        ensureOffscreenDocumentReady: async () => undefined,
        requestBlobRevocation: vi.fn(async () => undefined),
      })
    ).rejects.toThrow("Unable to query the existing offscreen document")
  })

  it("treats an offscreen document that disappears during the status query as idle", async () => {
    mocks.queryOffscreenStatus.mockResolvedValueOnce(null)
    mocks.getOffscreenContexts.mockResolvedValueOnce([])
    let activeTaskIds: string[] | undefined
    mocks.initializeFromStorage.mockImplementationOnce(async (dependencies) => {
      activeTaskIds = await dependencies.getOffscreenActiveTaskIds()
      return { queue: [], initFailed: false }
    })
    const { initializeBackgroundRuntime } =
      await import("@/entrypoints/background/background-startup")

    await expect(
      initializeBackgroundRuntime({
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        ensureLivenessAlarm: async () => undefined,
        ensureOffscreenDocumentReady: async () => undefined,
        requestBlobRevocation: vi.fn(async () => undefined),
      })
    ).resolves.toBeDefined()
    expect(activeTaskIds).toEqual([])
  })

  it("propagates initialization failures from recovery, hydration, and state creation", async () => {
    const { initializeBackgroundRuntime } =
      await import("@/entrypoints/background/background-startup")
    const input = {
      pendingDownloadsStore: createPendingDownloadsStoreStub(),
      ensureLivenessAlarm: async () => undefined,
      ensureOffscreenDocumentReady: async () => undefined,
      requestBlobRevocation: vi.fn(async () => undefined),
    }

    mocks.initializeFromStorage.mockResolvedValueOnce({
      queue: [],
      initFailed: true,
      error: "recovery failed",
    })
    await expect(initializeBackgroundRuntime(input)).rejects.toThrow(
      "recovery failed"
    )

    mocks.hydratePendingDownloads.mockRejectedValueOnce(
      new Error("hydrate failed")
    )
    await expect(initializeBackgroundRuntime(input)).rejects.toThrow(
      "hydrate failed"
    )

    mocks.createStateManager.mockRejectedValueOnce(new Error("state failed"))
    await expect(initializeBackgroundRuntime(input)).rejects.toThrow(
      "state failed"
    )
  })
})

describe("configureImageRefererRewriteRules", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("configures referer rewrite rules for image CDNs that reject extension-origin fetches", async () => {
    const updateSessionRules = vi.fn(async () => undefined)
    vi.stubGlobal("chrome", {
      declarativeNetRequest: {
        updateSessionRules,
        RuleActionType: {
          MODIFY_HEADERS: "modifyHeaders",
        },
        HeaderOperation: {
          SET: "set",
        },
        ResourceType: {
          XMLHTTPREQUEST: "xmlhttprequest",
          OTHER: "other",
        },
      },
    })

    const { configureImageRefererRewriteRules } =
      await import("@/entrypoints/background/background-startup")

    await configureImageRefererRewriteRules()

    expect(updateSessionRules).toHaveBeenCalledWith({
      removeRuleIds: [41001, 41002],
      addRules: expect.arrayContaining([
        expect.objectContaining({
          id: 41001,
          condition: expect.objectContaining({
            requestDomains: ["img-comic.pximg.net"],
          }),
        }),
        expect.objectContaining({
          id: 41002,
          action: expect.objectContaining({
            requestHeaders: [
              {
                header: "referer",
                operation: "set",
                value: "https://www.manhuagui.com/",
              },
            ],
          }),
          condition: expect.objectContaining({
            requestDomains: [
              "i.hamreus.com",
              "eu.hamreus.com",
              "eu1.hamreus.com",
              "eu2.hamreus.com",
              "us.hamreus.com",
              "us1.hamreus.com",
              "us2.hamreus.com",
              "us3.hamreus.com",
            ],
          }),
        }),
      ]),
    })
  })

  it("does nothing when declarativeNetRequest is unavailable", async () => {
    vi.stubGlobal("chrome", {})
    const { configureImageRefererRewriteRules } =
      await import("@/entrypoints/background/background-startup")

    await expect(configureImageRefererRewriteRules()).resolves.toBeUndefined()
  })

  it("contains session-rule update failures", async () => {
    const updateSessionRules = vi.fn(async () => {
      throw new Error("DNR unavailable")
    })
    vi.stubGlobal("chrome", {
      declarativeNetRequest: {
        updateSessionRules,
        RuleActionType: { MODIFY_HEADERS: "modifyHeaders" },
        HeaderOperation: { SET: "set" },
        ResourceType: { XMLHTTPREQUEST: "xmlhttprequest", OTHER: "other" },
      },
    })
    const { configureImageRefererRewriteRules } =
      await import("@/entrypoints/background/background-startup")

    await expect(configureImageRefererRewriteRules()).resolves.toBeUndefined()
    expect(updateSessionRules).toHaveBeenCalledTimes(1)
  })
})
