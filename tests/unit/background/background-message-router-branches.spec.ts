import { beforeEach, describe, expect, it, vi } from "vitest"
import { handleBackgroundMessage as handleBackgroundMessageImplementation } from "@/entrypoints/background/background-message-router"
import { DEFAULT_SETTINGS } from "@/src/storage/default-settings"
import { StateAction } from "@/src/types/state-actions"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import type { ExtensionMessage } from "@/src/types/extension-messages"
import { createPendingDownloadsStoreStub } from "./pending-output-test-helpers"

function handleBackgroundMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  deps: Parameters<typeof handleBackgroundMessageImplementation>[2]
) {
  const commandTypes = new Set([
    "STATE_ACTION",
    "SYNC_SETTINGS_TO_STATE",
    "ACKNOWLEDGE_ERROR",
    "START_DOWNLOAD",
    "RETRY_FAILED_CHAPTERS",
    "RESTART_TASK",
    "MOVE_TASK_TO_TOP",
    "CLEAR_ALL_HISTORY",
  ])
  const enriched = commandTypes.has(message.type)
    ? ({
        ...message,
        commandId: "00000000-0000-4000-8000-000000000001",
        issuedAt: 1,
      } as ExtensionMessage)
    : message
  return handleBackgroundMessageImplementation(enriched, sender, deps, true)
}

const mocks = vi.hoisted(() => ({
  settingsGetSettings: vi.fn(),
  canonicalizeSettingsDocument: vi.fn(),
  enablementServiceGetAll: vi.fn(),
  clearPersistentError: vi.fn(),
  enqueueStartDownloadTask: vi.fn(),
  processDownloadQueue: vi.fn(),
  retryFailedChapters: vi.fn(),
  restartTask: vi.fn(),
  moveTaskToTop: vi.fn(),
  clearAllHistory: vi.fn(),
  processStateAction: vi.fn(),
  handleOffscreenDownloadProgress: vi.fn(),
  getBackgroundSiteAdapterById: vi.fn(),
  fetchMangadexChapterList: vi.fn(),
  classifySenderOrigin: vi.fn(),
  resolveSourceTabId: vi.fn(),
  isSenderFromOptionsPage: vi.fn(),
  translate: vi.fn(),
  applyUiLanguagePreference: vi.fn(async () => undefined),
  loggerDebug: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  activeLeaseGet: vi.fn(),
  activeLeaseRenew: vi.fn(),
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: mocks.loggerDebug,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}))

vi.mock("@/src/storage/settings-service", () => ({
  canonicalizeSettingsDocument: mocks.canonicalizeSettingsDocument,
  settingsService: { getSettings: mocks.settingsGetSettings },
}))

vi.mock("@/src/storage/site-integration-enablement-service", () => ({
  siteIntegrationEnablementService: { getAll: mocks.enablementServiceGetAll },
}))

vi.mock("@/src/runtime/errors", () => ({
  clearPersistentError: mocks.clearPersistentError,
}))

vi.mock("@/entrypoints/background/download-queue", () => ({
  enqueueStartDownloadTask: mocks.enqueueStartDownloadTask,
  processDownloadQueue: mocks.processDownloadQueue,
  retryFailedChapters: mocks.retryFailedChapters,
  restartTask: mocks.restartTask,
  moveTaskToTop: mocks.moveTaskToTop,
  clearAllHistory: mocks.clearAllHistory,
}))

vi.mock("@/entrypoints/background/state-action-router", () => ({
  processStateAction: mocks.processStateAction,
}))

vi.mock("@/entrypoints/background/offscreen-progress-handler", () => ({
  handleOffscreenDownloadProgress: mocks.handleOffscreenDownloadProgress,
}))

vi.mock("@/src/runtime/active-dispatch-lease", () => ({
  activeDispatchLeaseStore: {
    get: mocks.activeLeaseGet,
    renew: mocks.activeLeaseRenew,
    clear: vi.fn(),
  },
}))

vi.mock("@/src/runtime/background-site-integration-initialization", () => ({
  getBackgroundSiteAdapterById: mocks.getBackgroundSiteAdapterById,
}))

vi.mock("@/src/site-integrations/mangadex/series-api", () => ({
  fetchMangadexChapterList: mocks.fetchMangadexChapterList,
}))

vi.mock("@/entrypoints/background/sender-resolution", () => ({
  classifySenderOrigin: mocks.classifySenderOrigin,
  resolveSourceTabId: mocks.resolveSourceTabId,
  isSenderFromOptionsPage: mocks.isSenderFromOptionsPage,
}))

vi.mock("@/src/runtime/i18n", () => ({
  t: mocks.translate,
  applyUiLanguagePreference: mocks.applyUiLanguagePreference,
}))

function createHarness(stateManager: Partial<CentralizedStateManager> = {}) {
  const ensureStateManagerInitialized = vi.fn(async () => undefined)
  const ensureOffscreenDocumentReady = vi.fn(async () => undefined)
  const requestBlobRevocation = vi.fn(async () => undefined)
  const store = createPendingDownloadsStoreStub()
  const manager = stateManager as CentralizedStateManager
  return {
    manager,
    ensureStateManagerInitialized,
    ensureOffscreenDocumentReady,
    requestBlobRevocation,
    store,
    deps: {
      ensureStateManagerInitialized,
      getStateManager: () => manager,
      ensureOffscreenDocumentReady,
      pendingDownloadsStore: store,
      requestBlobRevocation,
      tabContextResolver: undefined as
        | {
            resolveTabContext: (
              tabId: number,
              options?: { windowId?: number; allowCached?: boolean }
            ) => Promise<void>
          }
        | undefined,
    },
  }
}

const extensionSender = {
  url: "chrome-extension://extension-id/sidepanel.html",
} as chrome.runtime.MessageSender

const offscreenSender = {
  url: "chrome-extension://extension-id/offscreen.html",
} as chrome.runtime.MessageSender

const startDownloadMessage = {
  type: "START_DOWNLOAD",
  payload: {
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Series",
    chapters: [
      {
        id: "chapter-1",
        title: "Chapter 1",
        url: "https://mangadex.org/chapter/chapter-1",
        index: 1,
      },
    ],
  },
} as ExtensionMessage

describe("background message router branch behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.settingsGetSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mocks.canonicalizeSettingsDocument.mockImplementation(
      (value: unknown) => value
    )
    mocks.enablementServiceGetAll.mockResolvedValue({})
    mocks.classifySenderOrigin.mockReturnValue("extension-page")
    mocks.isSenderFromOptionsPage.mockReturnValue(true)
    mocks.translate.mockReturnValue("Unable to synchronize settings")
    mocks.activeLeaseGet.mockResolvedValue({
      jobId: "job-1",
      attempt: 1,
      taskId: "task-1",
      chapterId: "chapter-1",
    })
    mocks.activeLeaseRenew.mockResolvedValue(true)
    vi.stubGlobal("chrome", {
      runtime: {
        id: "extension-id",
        getURL: vi.fn(
          (path: string) => `chrome-extension://extension-id/${path}`
        ),
      },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
        },
      },
      tabs: {
        query: vi.fn(async () => []),
        get: vi.fn(async () => ({ id: 7, active: true, windowId: 2 })),
        update: vi.fn(async () => undefined),
        create: vi.fn(async () => undefined),
      },
      windows: { update: vi.fn(async () => undefined) },
      downloads: {
        download: vi.fn(async () => 1),
        search: vi.fn(async () => []),
      },
    })
  })

  it("refreshes the active Side Panel tab through the background resolver", async () => {
    mocks.resolveSourceTabId.mockReturnValue(7)
    const resolveTabContext = vi.fn(async () => undefined)
    const harness = createHarness()
    harness.deps.tabContextResolver = { resolveTabContext }

    await expect(
      handleBackgroundMessage(
        {
          type: "REQUEST_TAB_CONTEXT_REFRESH",
          payload: { tabId: 7, windowId: 2, reason: "sidepanel-mount" },
        },
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({ success: true })

    expect(resolveTabContext).toHaveBeenCalledWith(7, {
      windowId: 2,
      allowCached: true,
    })
  })

  it("returns state-action failures with the handler reason", async () => {
    mocks.processStateAction.mockResolvedValue({
      success: false,
      error: "task is immutable",
    })
    const harness = createHarness()

    await expect(
      handleBackgroundMessage(
        { type: "STATE_ACTION", action: StateAction.INITIALIZE_TAB },
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({ success: false, error: "task is immutable" })
  })

  it("uses a stable fallback when a state-action failure has no reason", async () => {
    mocks.processStateAction.mockResolvedValue({ success: false })
    const harness = createHarness()

    await expect(
      handleBackgroundMessage(
        { type: "STATE_ACTION", action: StateAction.INITIALIZE_TAB },
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({ success: false, error: "Unknown error" })
  })

  it.each([
    [new Error("state unavailable"), "state unavailable"],
    ["not-an-error", "Unknown error"],
  ])("structures thrown state-action errors %#", async (thrown, expected) => {
    mocks.processStateAction.mockRejectedValue(thrown)
    const harness = createHarness()

    await expect(
      handleBackgroundMessage(
        { type: "STATE_ACTION", action: StateAction.INITIALIZE_TAB },
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({ success: false, error: expected })
  })

  it("advances the queue after a successful cancellation action", async () => {
    mocks.processStateAction.mockResolvedValue({ success: true })
    const harness = createHarness()

    const response = await handleBackgroundMessage(
      {
        type: "STATE_ACTION",
        action: StateAction.CANCEL_DOWNLOAD_TASK,
        payload: { taskId: "task-1" },
      },
      extensionSender,
      harness.deps
    )

    expect(response).toEqual({ success: true, data: undefined })
    expect(mocks.processDownloadQueue).toHaveBeenCalledWith(
      harness.manager,
      harness.ensureOffscreenDocumentReady
    )
  })

  it("acknowledges persistent errors without mutating destination issue state", async () => {
    const harness = createHarness()

    const response = await handleBackgroundMessage(
      {
        type: "ACKNOWLEDGE_ERROR",
        payload: { code: "FSA_HANDLE_INVALID" },
      } as ExtensionMessage,
      extensionSender,
      harness.deps
    )

    expect(response).toEqual({ success: true })
    expect(chrome.storage.local.set).not.toHaveBeenCalled()
    expect(mocks.clearPersistentError).toHaveBeenCalledWith(
      "FSA_HANDLE_INVALID"
    )
  })

  it("acknowledges non-FSA errors without reading the FSA record", async () => {
    const harness = createHarness()

    await handleBackgroundMessage(
      { type: "ACKNOWLEDGE_ERROR", payload: { code: "NETWORK_ERROR" } },
      extensionSender,
      harness.deps
    )

    expect(chrome.storage.local.get).not.toHaveBeenCalled()
    expect(mocks.clearPersistentError).toHaveBeenCalledWith("NETWORK_ERROR")
  })

  it("reports persistent-error acknowledgement failures", async () => {
    mocks.clearPersistentError.mockRejectedValue(new Error("storage down"))
    const harness = createHarness()

    await expect(
      handleBackgroundMessage(
        {
          type: "ACKNOWLEDGE_ERROR",
          payload: { code: "FSA_HANDLE_INVALID" },
        } as ExtensionMessage,
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({
      success: false,
      error: "Failed to acknowledge error",
    })
    expect(mocks.clearPersistentError).toHaveBeenCalledWith(
      "FSA_HANDLE_INVALID"
    )
  })

  it("returns settings as the GET_SETTINGS response body", async () => {
    const harness = createHarness()

    const response = await handleBackgroundMessage(
      { type: "GET_SETTINGS" } as ExtensionMessage,
      extensionSender,
      harness.deps
    )

    expect(response).toEqual({ success: true, ...DEFAULT_SETTINGS })
  })

  it.each([
    [new Error("settings corrupt"), "settings corrupt"],
    [17, "Failed to load settings"],
  ])("structures GET_SETTINGS read failures %#", async (thrown, expected) => {
    mocks.settingsGetSettings.mockRejectedValue(thrown)
    const harness = createHarness()

    await expect(
      handleBackgroundMessage(
        { type: "GET_SETTINGS" } as ExtensionMessage,
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({ success: false, error: expected })
  })

  it("uses a stable enablement error for non-Error rejections", async () => {
    mocks.enablementServiceGetAll.mockRejectedValue("storage down")
    const harness = createHarness()

    await expect(
      handleBackgroundMessage(
        { type: "GET_SITE_INTEGRATION_ENABLEMENT" } as ExtensionMessage,
        offscreenSender,
        harness.deps
      )
    ).resolves.toEqual({
      success: false,
      error: "Failed to load site integration enablement",
    })
  })

  it("rejects malformed series requests before resolving an integration", async () => {
    const harness = createHarness()

    await expect(
      handleBackgroundMessage(
        {
          type: "FETCH_SERIES_DATA",
          payload: { siteIntegrationId: "", seriesId: "" },
        } as unknown as ExtensionMessage,
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({
      success: false,
      error: "Invalid FETCH_SERIES_DATA payload",
    })
    expect(mocks.getBackgroundSiteAdapterById).not.toHaveBeenCalled()
  })

  it("reports integrations that do not expose series loaders", async () => {
    mocks.getBackgroundSiteAdapterById.mockResolvedValue({
      id: "comicnettai",
      background: {},
    })
    const harness = createHarness()

    await expect(
      handleBackgroundMessage(
        {
          type: "FETCH_SERIES_DATA",
          payload: { siteIntegrationId: "comicnettai", seriesId: "series-1" },
        } as ExtensionMessage,
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({
      success: false,
      error:
        "Site integration comicnettai does not provide background series loaders",
    })
  })

  it("preserves independent metadata and chapter failures", async () => {
    const fetchSeriesMetadata = vi.fn(async () => {
      throw new Error("metadata unavailable")
    })
    const fetchChapterList = vi.fn(() => Promise.reject("chapter rejection"))
    mocks.getBackgroundSiteAdapterById.mockResolvedValue({
      id: "comicnettai",
      background: { series: { fetchSeriesMetadata, fetchChapterList } },
    })
    const harness = createHarness()

    const response = await handleBackgroundMessage(
      {
        type: "FETCH_SERIES_DATA",
        payload: { siteIntegrationId: "comicnettai", seriesId: "series-1" },
      } as ExtensionMessage,
      extensionSender,
      harness.deps
    )

    expect(response).toEqual({
      success: true,
      seriesId: "series-1",
      seriesMetadata: undefined,
      chapterList: undefined,
      metadataError: "metadata unavailable",
      chapterListError: "chapter rejection",
    })
  })

  it("normalizes non-Error metadata failures and Error chapter failures independently", async () => {
    const fetchSeriesMetadata = vi.fn(() =>
      Promise.reject("metadata rejection")
    )
    const fetchChapterList = vi.fn(async () => {
      throw new Error("chapters unavailable")
    })
    mocks.getBackgroundSiteAdapterById.mockResolvedValue({
      id: "comicnettai",
      background: { series: { fetchSeriesMetadata, fetchChapterList } },
    })
    const harness = createHarness()

    await expect(
      handleBackgroundMessage(
        {
          type: "FETCH_SERIES_DATA",
          payload: { siteIntegrationId: "comicnettai", seriesId: "series-1" },
        } as ExtensionMessage,
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({
      success: true,
      seriesId: "series-1",
      seriesMetadata: undefined,
      chapterList: undefined,
      metadataError: "metadata rejection",
      chapterListError: "chapters unavailable",
    })
  })

  it.each([
    [new Error("adapter registry failed"), "adapter registry failed"],
    ["adapter registry failed", "Failed to fetch series data"],
  ])(
    "structures integration-resolution failures %#",
    async (thrown, expected) => {
      mocks.getBackgroundSiteAdapterById.mockRejectedValue(thrown)
      const harness = createHarness()

      await expect(
        handleBackgroundMessage(
          {
            type: "FETCH_SERIES_DATA",
            payload: { siteIntegrationId: "mangadex", seriesId: "series-1" },
          } as ExtensionMessage,
          extensionSender,
          harness.deps
        )
      ).resolves.toEqual({ success: false, error: expected })
    }
  )

  it("rejects settings documents that fail canonical validation", async () => {
    mocks.canonicalizeSettingsDocument.mockReturnValue(null)
    const harness = createHarness({ updateGlobalState: vi.fn() })

    await expect(
      handleBackgroundMessage(
        {
          type: "SYNC_SETTINGS_TO_STATE",
          payload: { settings: {} },
        } as unknown as ExtensionMessage,
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({
      success: false,
      error: "Invalid SYNC_SETTINGS_TO_STATE payload",
    })
    expect(harness.ensureStateManagerInitialized).not.toHaveBeenCalled()
  })

  it("applies the synchronized UI language before publishing settings", async () => {
    const settings = { ...DEFAULT_SETTINGS, uiLanguage: "zh_TW" as const }
    const updateGlobalState = vi.fn(async () => undefined)
    mocks.canonicalizeSettingsDocument.mockReturnValue(settings)
    const harness = createHarness({ updateGlobalState })

    await expect(
      handleBackgroundMessage(
        {
          type: "SYNC_SETTINGS_TO_STATE",
          payload: { settings },
        },
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({ success: true })

    expect(mocks.applyUiLanguagePreference).toHaveBeenCalledWith("zh_TW")
    expect(updateGlobalState).toHaveBeenCalledWith({ settings })
  })

  it.each([
    [new Error("state write failed"), "state write failed"],
    ["state write failed", "Unable to synchronize settings"],
  ])(
    "structures settings synchronization failures %#",
    async (thrown, expected) => {
      const harness = createHarness({
        updateGlobalState: vi.fn(async () => {
          throw thrown
        }),
      })

      await expect(
        handleBackgroundMessage(
          {
            type: "SYNC_SETTINGS_TO_STATE",
            payload: { settings: DEFAULT_SETTINGS },
          },
          extensionSender,
          harness.deps
        )
      ).resolves.toEqual({ success: false, error: expected })
    }
  )

  it("revokes the blob when Chrome returns no numeric download id", async () => {
    vi.mocked(chrome.downloads.download).mockResolvedValue(undefined as never)
    mocks.classifySenderOrigin.mockReturnValue("offscreen")
    const harness = createHarness({
      getGlobalState: vi.fn(async () => ({
        downloadQueue: [
          {
            id: "task-1",
            status: "downloading",
            settingsSnapshot: { overwriteExisting: false },
          },
        ],
      })),
      updateDownloadTask: vi.fn(),
    } as unknown as Partial<CentralizedStateManager>)

    const response = await handleBackgroundMessage(
      {
        type: "OFFSCREEN_OUTPUT_READY",
        payload: {
          jobId: "job-1",
          attempt: 1,
          outputId: "job-1:archive:0",
          taskId: "task-1",
          chapterId: "chapter-1",
          fileUrl: "blob:chrome-extension://extension-id/archive",
          filename: "Series/Chapter.cbz",
          outputIndex: 0,
          outputCount: 1,
          outputKind: "archive",
        },
      } as ExtensionMessage,
      offscreenSender,
      harness.deps
    )

    expect(response).toEqual({
      success: false,
      error: "downloads.download returned no download id",
    })
    expect(harness.requestBlobRevocation).toHaveBeenCalledWith({
      jobId: "job-1",
      attempt: 1,
      outputId: "job-1:archive:0",
      blobUrl: "blob:chrome-extension://extension-id/archive",
    })
    expect(harness.store.prepare).toHaveBeenCalledTimes(1)
    expect(harness.store.markPreparedInterrupted).toHaveBeenCalledWith(
      "job-1:archive:0",
      "downloads.download returned no download id"
    )
  })

  it.each([
    [new Error("download denied"), "download denied"],
    ["download denied", "Chrome rejected the download"],
  ])(
    "revokes blobs and structures Chrome download failures %#",
    async (thrown, expected) => {
      vi.mocked(chrome.downloads.download).mockRejectedValue(thrown)
      mocks.classifySenderOrigin.mockReturnValue("offscreen")
      const harness = createHarness({
        getGlobalState: vi.fn(async () => ({
          downloadQueue: [
            {
              id: "task-1",
              status: "downloading",
              settingsSnapshot: { overwriteExisting: false },
            },
          ],
        })),
        updateDownloadTask: vi.fn(),
      } as unknown as Partial<CentralizedStateManager>)

      await expect(
        handleBackgroundMessage(
          {
            type: "OFFSCREEN_OUTPUT_READY",
            payload: {
              jobId: "job-1",
              attempt: 1,
              outputId: "job-1:archive:0",
              taskId: "task-1",
              chapterId: "chapter-1",
              fileUrl: "blob:chrome-extension://extension-id/archive",
              filename: "Series/Chapter.cbz",
              outputIndex: 0,
              outputCount: 1,
              outputKind: "archive",
            },
          } as ExtensionMessage,
          offscreenSender,
          harness.deps
        )
      ).resolves.toEqual({ success: false, error: expected })
      expect(harness.requestBlobRevocation).toHaveBeenCalledTimes(1)
    }
  )

  describe.each([
    {
      type: "RETRY_FAILED_CHAPTERS" as const,
      invoke: mocks.retryFailedChapters,
      senderError:
        "RETRY_FAILED_CHAPTERS is only available from extension pages",
      defaultError: "Retry failed",
      callsQueue: true,
    },
    {
      type: "RESTART_TASK" as const,
      invoke: mocks.restartTask,
      senderError: "RESTART_TASK is only available from extension pages",
      defaultError: "Restart failed",
      callsQueue: true,
    },
    {
      type: "MOVE_TASK_TO_TOP" as const,
      invoke: mocks.moveTaskToTop,
      senderError: "MOVE_TASK_TO_TOP is only available from extension pages",
      defaultError: "Unable to move task to top",
      callsQueue: false,
    },
  ])(
    "$type task command",
    ({ type, invoke, senderError, defaultError, callsQueue }) => {
      it("rejects malformed task ids before initialization", async () => {
        const harness = createHarness()

        await expect(
          handleBackgroundMessage(
            { type, payload: { taskId: "" } } as unknown as ExtensionMessage,
            extensionSender,
            harness.deps
          )
        ).resolves.toEqual({ success: false, error: "Missing taskId" })
        expect(harness.ensureStateManagerInitialized).not.toHaveBeenCalled()
      })

      it("rejects content-script senders before initialization", async () => {
        mocks.classifySenderOrigin.mockReturnValue("content-script")
        const harness = createHarness()

        await expect(
          handleBackgroundMessage(
            { type, payload: { taskId: "task-1" } } as ExtensionMessage,
            {
              url: "https://example.com/chapter",
            } as chrome.runtime.MessageSender,
            harness.deps
          )
        ).resolves.toEqual({ success: false, error: senderError })
        expect(harness.ensureStateManagerInitialized).not.toHaveBeenCalled()
      })

      it("returns the command failure reason without processing the queue", async () => {
        invoke.mockResolvedValue({ success: false, reason: "invalid status" })
        const harness = createHarness()

        await expect(
          handleBackgroundMessage(
            { type, payload: { taskId: "task-1" } } as ExtensionMessage,
            extensionSender,
            harness.deps
          )
        ).resolves.toEqual({ success: false, error: "invalid status" })
        expect(mocks.processDownloadQueue).not.toHaveBeenCalled()
      })

      it("uses the command-specific fallback when no reason is returned", async () => {
        invoke.mockResolvedValue({ success: false })
        const harness = createHarness()

        await expect(
          handleBackgroundMessage(
            { type, payload: { taskId: "task-1" } } as ExtensionMessage,
            extensionSender,
            harness.deps
          )
        ).resolves.toEqual({ success: false, error: defaultError })
      })

      it.each([
        [new Error("command exploded"), "command exploded"],
        ["command exploded", defaultError],
      ])("structures command exceptions %#", async (thrown, expected) => {
        invoke.mockRejectedValue(thrown)
        const harness = createHarness()

        await expect(
          handleBackgroundMessage(
            { type, payload: { taskId: "task-1" } } as ExtensionMessage,
            extensionSender,
            harness.deps
          )
        ).resolves.toEqual({ success: false, error: expected })
      })

      it("returns success and only advances the queue for retry/restart", async () => {
        invoke.mockResolvedValue({ success: true })
        const harness = createHarness()

        await expect(
          handleBackgroundMessage(
            { type, payload: { taskId: "task-1" } } as ExtensionMessage,
            extensionSender,
            harness.deps
          )
        ).resolves.toEqual({ success: true })

        if (callsQueue) {
          expect(mocks.processDownloadQueue).toHaveBeenCalledWith(
            harness.manager,
            harness.ensureOffscreenDocumentReady
          )
        } else {
          expect(mocks.processDownloadQueue).not.toHaveBeenCalled()
        }
      })
    }
  )

  it("rejects malformed CLEAR_ALL_HISTORY messages before sender checks", async () => {
    const harness = createHarness()

    await expect(
      handleBackgroundMessage(
        {
          type: "CLEAR_ALL_HISTORY",
          payload: "invalid",
        } as unknown as ExtensionMessage,
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({
      success: false,
      error: "Invalid CLEAR_ALL_HISTORY payload",
    })
    expect(mocks.isSenderFromOptionsPage).not.toHaveBeenCalled()
  })

  it("returns the number of history tasks actually removed", async () => {
    mocks.clearAllHistory.mockResolvedValue({ removedCount: 7 })
    const harness = createHarness()

    await expect(
      handleBackgroundMessage(
        { type: "CLEAR_ALL_HISTORY", payload: {} },
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({ success: true, removedCount: 7 })
  })

  it.each([
    [new Error("clear failed"), "clear failed"],
    ["clear failed", "Unable to clear history"],
  ])("structures clear-history failures %#", async (thrown, expected) => {
    mocks.clearAllHistory.mockRejectedValue(thrown)
    const harness = createHarness()

    await expect(
      handleBackgroundMessage(
        { type: "CLEAR_ALL_HISTORY", payload: {} },
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({ success: false, error: expected })
  })

  it("rejects malformed OPEN_OPTIONS destinations without using Chrome tabs", async () => {
    const harness = createHarness()

    await expect(
      handleBackgroundMessage(
        {
          type: "OPEN_OPTIONS",
          payload: { page: "secrets" },
        } as unknown as ExtensionMessage,
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({
      success: false,
      error: "Invalid OPEN_OPTIONS payload",
    })
    expect(chrome.tabs.query).not.toHaveBeenCalled()
  })

  it("activates an existing options tab and focuses its window", async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 17, windowId: 9 } as chrome.tabs.Tab,
    ] as never)
    const harness = createHarness()

    const response = await handleBackgroundMessage(
      { type: "OPEN_OPTIONS", payload: { page: "downloads" } },
      extensionSender,
      harness.deps
    )

    expect(response).toEqual({ success: true })
    expect(chrome.tabs.update).toHaveBeenCalledWith(17, {
      active: true,
      url: "chrome-extension://extension-id/options.html?tab=downloads",
    })
    expect(chrome.windows.update).toHaveBeenCalledWith(9, { focused: true })
    expect(chrome.tabs.create).not.toHaveBeenCalled()
  })

  it("activates an existing options tab even when no window id is reported", async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 17 } as chrome.tabs.Tab,
    ] as never)
    const harness = createHarness()

    await handleBackgroundMessage(
      { type: "OPEN_OPTIONS", payload: {} },
      extensionSender,
      harness.deps
    )

    expect(chrome.tabs.update).toHaveBeenCalledTimes(1)
    expect(chrome.windows.update).not.toHaveBeenCalled()
  })

  it("creates an options tab when none exists", async () => {
    const harness = createHarness()

    await expect(
      handleBackgroundMessage(
        { type: "OPEN_OPTIONS", payload: {} },
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({ success: true })
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: "chrome-extension://extension-id/options.html",
      active: true,
    })
  })

  it.each([
    [new Error("tab API unavailable"), "tab API unavailable"],
    ["tab API unavailable", "Failed to open options page"],
  ])("structures options-tab API failures %#", async (thrown, expected) => {
    vi.mocked(chrome.tabs.query).mockRejectedValue(thrown)
    const harness = createHarness()

    await expect(
      handleBackgroundMessage(
        { type: "OPEN_OPTIONS", payload: {} },
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({ success: false, error: expected })
  })

  it("rejects malformed START_DOWNLOAD payloads before initialization", async () => {
    const harness = createHarness()

    await expect(
      handleBackgroundMessage(
        {
          type: "START_DOWNLOAD",
          payload: { chapters: [] },
        } as unknown as ExtensionMessage,
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({
      success: false,
      error: "Invalid START_DOWNLOAD payload",
    })
    expect(harness.ensureStateManagerInitialized).not.toHaveBeenCalled()
  })

  it("rejects START_DOWNLOAD when neither sender nor payload identifies a tab", async () => {
    mocks.resolveSourceTabId.mockReturnValue(undefined)
    const harness = createHarness()

    await expect(
      handleBackgroundMessage(
        startDownloadMessage,
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({
      success: false,
      error: "Unable to resolve sender tab for START_DOWNLOAD",
    })
    expect(mocks.enqueueStartDownloadTask).not.toHaveBeenCalled()
  })

  it.each([
    [{ success: false, reason: "queue full" }, "queue full"],
    [{ success: false }, "Failed to enqueue download task"],
    [{ success: true }, "Failed to enqueue download task"],
  ])("reports unsuccessful enqueue outcomes %#", async (result, expected) => {
    mocks.resolveSourceTabId.mockReturnValue(12)
    mocks.enqueueStartDownloadTask.mockResolvedValue(result)
    const harness = createHarness()

    await expect(
      handleBackgroundMessage(
        startDownloadMessage,
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({ success: false, error: expected })
    expect(mocks.processDownloadQueue).not.toHaveBeenCalled()
  })

  it("returns the task id before background queue processing settles", async () => {
    mocks.resolveSourceTabId.mockReturnValue(12)
    mocks.enqueueStartDownloadTask.mockResolvedValue({
      success: true,
      taskId: "task-new",
    })
    mocks.processDownloadQueue.mockRejectedValue(new Error("runner failed"))
    const harness = createHarness()

    await expect(
      handleBackgroundMessage(
        startDownloadMessage,
        extensionSender,
        harness.deps
      )
    ).resolves.toEqual({ success: true, taskId: "task-new" })
    await vi.waitFor(() => {
      expect(mocks.loggerError).toHaveBeenCalledWith(
        "Failed to process download queue after START_DOWNLOAD:",
        expect.any(Error)
      )
    })
  })

  it.each([
    [new Error("initialization failed"), "initialization failed"],
    ["initialization failed", "Unknown error"],
  ])(
    "structures failures outside command-local handlers %#",
    async (thrown, expected) => {
      const harness = createHarness()
      harness.ensureStateManagerInitialized.mockRejectedValue(thrown)

      await expect(
        handleBackgroundMessage(
          startDownloadMessage,
          extensionSender,
          harness.deps
        )
      ).resolves.toEqual({ success: false, error: expected })
    }
  )

  it("rejects malformed offscreen progress before sender authorization", async () => {
    const harness = createHarness()

    await expect(
      handleBackgroundMessage(
        {
          type: "OFFSCREEN_DOWNLOAD_PROGRESS",
          payload: { taskId: "task-1", chapterId: "", status: "downloading" },
        } as unknown as ExtensionMessage,
        offscreenSender,
        harness.deps
      )
    ).resolves.toEqual({
      success: false,
      error: "Invalid OFFSCREEN_DOWNLOAD_PROGRESS payload",
    })
    expect(mocks.classifySenderOrigin).not.toHaveBeenCalled()
  })

  it("returns the offscreen progress handler response", async () => {
    mocks.classifySenderOrigin.mockReturnValue("offscreen")
    mocks.handleOffscreenDownloadProgress.mockResolvedValue({
      success: true,
      acknowledged: true,
    })
    const harness = createHarness()
    const message = {
      type: "OFFSCREEN_DOWNLOAD_PROGRESS",
      payload: {
        jobId: "job-1",
        attempt: 1,
        taskId: "task-1",
        chapterId: "chapter-1",
        sequence: 1,
        stage: "downloading",
        status: "downloading",
      },
    } as ExtensionMessage

    const response = await handleBackgroundMessage(
      message,
      offscreenSender,
      harness.deps
    )

    expect(response).toEqual({ success: true, acknowledged: true })
    expect(mocks.handleOffscreenDownloadProgress).toHaveBeenCalledWith(
      harness.manager,
      message
    )
  })

  it.each([
    [new Error("progress handler failed"), "progress handler failed"],
    ["progress handler failed", "Unknown error"],
  ])(
    "structures thrown offscreen progress failures %#",
    async (thrown, expected) => {
      mocks.classifySenderOrigin.mockReturnValue("offscreen")
      mocks.handleOffscreenDownloadProgress.mockRejectedValue(thrown)
      const harness = createHarness()

      await expect(
        handleBackgroundMessage(
          {
            type: "OFFSCREEN_DOWNLOAD_PROGRESS",
            payload: {
              jobId: "job-1",
              attempt: 1,
              taskId: "task-1",
              chapterId: "chapter-1",
              sequence: 1,
              stage: "downloading",
              status: "downloading",
            },
          } as ExtensionMessage,
          offscreenSender,
          harness.deps
        )
      ).resolves.toEqual({ success: false, error: expected })
    }
  )

  it.each(["OFFSCREEN_STATUS", "OFFSCREEN_CONTROL", "REVOKE_BLOB_URL"])(
    "ignores the reserved %s message rather than acknowledging it",
    async (type) => {
      const harness = createHarness()

      const response = await handleBackgroundMessage(
        { type } as ExtensionMessage,
        offscreenSender,
        harness.deps
      )

      expect(response).toBeNull()
      expect(harness.ensureStateManagerInitialized).not.toHaveBeenCalled()
    }
  )

  it("ignores unknown messages without touching dependencies", async () => {
    const harness = createHarness()

    const response = await handleBackgroundMessage(
      { type: "FUTURE_MESSAGE" } as unknown as ExtensionMessage,
      extensionSender,
      harness.deps
    )

    expect(response).toBeNull()
    expect(harness.ensureStateManagerInitialized).not.toHaveBeenCalled()
    expect(mocks.loggerDebug).toHaveBeenCalledWith(
      "Background ignoring message type: FUTURE_MESSAGE"
    )
  })
})
