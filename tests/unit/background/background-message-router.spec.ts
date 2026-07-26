import { beforeEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_SETTINGS } from "@/src/storage/default-settings"
import { handleBackgroundMessage as handleBackgroundMessageImplementation } from "@/entrypoints/background/background-message-router"
import { StateAction } from "@/src/types/state-actions"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import type { ExtensionMessage } from "@/src/types/extension-messages"
import {
  createPendingDownloadsStoreStub,
  createPendingOutputRecord,
} from "./pending-output-test-helpers"

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
    "CLEAR_PERSISTED_DOWNLOAD_HISTORY",
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
  classifySenderOrigin: vi.fn(),
  resolveSourceTabId: vi.fn(),
  isSenderFromOptionsPage: vi.fn(),
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
  settingsService: {
    getSettings: mocks.settingsGetSettings,
  },
}))

vi.mock("@/src/storage/site-integration-enablement-service", () => ({
  siteIntegrationEnablementService: {
    getAll: mocks.enablementServiceGetAll,
  },
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

vi.mock("@/entrypoints/background/sender-resolution", () => ({
  classifySenderOrigin: mocks.classifySenderOrigin,
  resolveSourceTabId: mocks.resolveSourceTabId,
  isSenderFromOptionsPage: mocks.isSenderFromOptionsPage,
}))

describe("handleBackgroundMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.settingsGetSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mocks.canonicalizeSettingsDocument.mockImplementation(
      (value: unknown) => value
    )
    mocks.getBackgroundSiteAdapterById.mockResolvedValue(undefined)
    mocks.enablementServiceGetAll.mockResolvedValue({})
    mocks.classifySenderOrigin.mockReturnValue("offscreen")
    mocks.activeLeaseGet.mockResolvedValue({
      jobId: "job-1",
      attempt: 1,
      taskId: "task-1",
      chapterId: "chapter-1",
    })
    mocks.activeLeaseRenew.mockResolvedValue(true)
  })

  it("syncs centralized state from the authoritative payload without re-reading settings", async () => {
    const syncedSettings = {
      ...DEFAULT_SETTINGS,
      downloads: {
        ...DEFAULT_SETTINGS.downloads,
        defaultFormat: "zip" as const,
      },
    }
    const updateGlobalState = vi.fn(async () => undefined)
    const ensureStateManagerInitialized = vi.fn(async () => undefined)

    mocks.settingsGetSettings.mockRejectedValueOnce(
      new Error("stale settings read")
    )

    const response = await handleBackgroundMessage(
      {
        type: "SYNC_SETTINGS_TO_STATE",
        payload: { settings: syncedSettings },
      } as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized,
        getStateManager: () =>
          ({ updateGlobalState }) as unknown as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      }
    )

    expect(response).toEqual({ success: true })
    expect(mocks.settingsGetSettings).not.toHaveBeenCalled()
    expect(ensureStateManagerInitialized).toHaveBeenCalledTimes(1)
    expect(updateGlobalState).toHaveBeenCalledTimes(1)
    expect(updateGlobalState).toHaveBeenCalledWith({
      settings: syncedSettings,
    })
  })

  it("rejects malformed SYNC_SETTINGS_TO_STATE payloads before touching state", async () => {
    const ensureStateManagerInitialized = vi.fn(async () => undefined)
    const updateGlobalState = vi.fn(async () => undefined)

    const response = await handleBackgroundMessage(
      {
        type: "SYNC_SETTINGS_TO_STATE",
        payload: {},
      } as unknown as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized,
        getStateManager: () =>
          ({ updateGlobalState }) as unknown as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      }
    )

    expect(response).toEqual({
      success: false,
      error: "Invalid SYNC_SETTINGS_TO_STATE payload",
    })
    expect(ensureStateManagerInitialized).not.toHaveBeenCalled()
    expect(updateGlobalState).not.toHaveBeenCalled()
  })

  it("rejects malformed STATE_ACTION messages before routing them to the state-action handler", async () => {
    const response = await handleBackgroundMessage(
      {
        type: "STATE_ACTION",
        payload: { foo: "bar" },
      } as unknown as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () => ({}) as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      }
    )

    expect(response).toEqual({
      success: false,
      error: "Invalid STATE_ACTION message shape",
    })
    expect(mocks.processStateAction).not.toHaveBeenCalled()
  })

  it("rejects task-management state actions from content-script senders", async () => {
    mocks.classifySenderOrigin.mockReturnValueOnce("content-script")
    mocks.processStateAction.mockResolvedValueOnce({ success: true })

    const response = await handleBackgroundMessage(
      {
        type: "STATE_ACTION",
        action: StateAction.REMOVE_DOWNLOAD_TASK,
        payload: { taskId: "task-1" },
      } as unknown as ExtensionMessage,
      {
        tab: { id: 11 },
        url: "https://mangadex.org/title/series-1",
      } as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () => ({}) as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      }
    )

    expect(response).toEqual({
      success: false,
      error: "Task-management actions are only accepted from extension pages",
    })
    expect(mocks.processStateAction).not.toHaveBeenCalled()
  })

  it("allows task-management state actions from extension-page senders", async () => {
    mocks.classifySenderOrigin.mockReturnValueOnce("extension-page")
    mocks.processStateAction.mockResolvedValueOnce({ success: true })

    const response = await handleBackgroundMessage(
      {
        type: "STATE_ACTION",
        action: StateAction.CANCEL_DOWNLOAD_TASK,
        payload: { taskId: "task-1" },
      } as unknown as ExtensionMessage,
      {
        url: "chrome-extension://extension-id/sidepanel.html",
      } as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () => ({}) as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      }
    )

    expect(response).toEqual({ success: true, data: undefined })
    expect(mocks.processStateAction).toHaveBeenCalledTimes(1)
  })

  it("allows tab-state actions from content-script senders", async () => {
    mocks.processStateAction.mockResolvedValueOnce({ success: true })

    const response = await handleBackgroundMessage(
      {
        type: "STATE_ACTION",
        action: StateAction.INITIALIZE_TAB,
        payload: { context: "unsupported" },
        tabId: 11,
      } as unknown as ExtensionMessage,
      {
        tab: { id: 11 },
        url: "https://mangadex.org/title/series-1",
      } as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () => ({}) as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      }
    )

    expect(response).toEqual({ success: true, data: undefined })
    expect(mocks.processStateAction).toHaveBeenCalledTimes(1)
  })

  it("fetches API-backed series data through the background integration runtime", async () => {
    const fetchSeriesMetadata = vi.fn(async () => ({ title: "Series Title" }))
    const fetchChapterList = vi.fn(async () => ({
      chapters: [
        { id: "ch-1", url: "https://example.com/ch-1", title: "Chapter 1" },
      ],
    }))
    mocks.getBackgroundSiteAdapterById.mockResolvedValueOnce({
      id: "mangadex",
      background: {
        name: "MangaDex Background",
        series: {
          fetchSeriesMetadata,
          fetchChapterList,
        },
        chapter: {
          processImageUrls: async (urls: string[]) => urls,
          downloadImage: async () => ({
            data: new ArrayBuffer(0),
            filename: "image.png",
            mimeType: "image/png",
          }),
        },
      },
    })

    const response = await handleBackgroundMessage(
      {
        type: "FETCH_SERIES_DATA",
        payload: {
          siteIntegrationId: "mangadex",
          seriesId: "series-1",
          language: "en",
        },
      } as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () => ({}) as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      }
    )

    expect(response).toEqual({
      success: true,
      seriesId: "series-1",
      seriesMetadata: { title: "Series Title" },
      chapterList: {
        chapters: [
          { id: "ch-1", url: "https://example.com/ch-1", title: "Chapter 1" },
        ],
      },
      metadataError: undefined,
      chapterListError: undefined,
    })
    expect(mocks.getBackgroundSiteAdapterById).toHaveBeenCalledWith("mangadex")
    expect(fetchSeriesMetadata).toHaveBeenCalledWith("series-1", "en")
    expect(fetchChapterList).toHaveBeenCalledWith("series-1", "en")
  })

  it("passes validated MangaDex preferences request-locally to chapter resolution", async () => {
    const resolveSeriesData = vi.fn(async () => ({
      seriesId: "series-1",
      seriesMetadata: { title: "Series Title" },
      chapterList: { chapters: [] },
    }))
    const preferences = {
      dataSaver: false,
      filteredLanguages: ["ja"],
      showSafe: true,
      showSuggestive: false,
      showErotic: false,
      showHentai: false,
    }
    mocks.getBackgroundSiteAdapterById.mockResolvedValueOnce({
      id: "mangadex",
      background: {
        name: "MangaDex Background",
        series: {
          resolveSeriesData,
        },
      },
    })

    const response = await handleBackgroundMessage(
      {
        type: "FETCH_SERIES_DATA",
        payload: {
          siteIntegrationId: "mangadex",
          seriesId: "series-1",
          mangadexPreferences: preferences,
        },
      } as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () => ({}) as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      }
    )

    expect(response).toMatchObject({
      success: true,
      chapterList: { chapters: [] },
    })
    expect(resolveSeriesData).toHaveBeenCalledWith({
      seriesUrl: "",
      seriesId: "series-1",
      language: undefined,
      mangadexPreferences: preferences,
    })
  })

  it("rejects malformed OFFSCREEN_OUTPUT_READY payloads before touching downloads", async () => {
    const response = await handleBackgroundMessage(
      {
        type: "OFFSCREEN_OUTPUT_READY",
        payload: {
          jobId: "job-1",
          attempt: 1,
          outputId: "job-1:archive:0",
          taskId: "task-1",
          chapterId: "",
          fileUrl: "blob:chrome-extension://abc",
          filename: "Series/Chapter 1.cbz",
          outputIndex: 0,
          outputCount: 1,
          outputKind: "archive",
        },
      } as unknown as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () => ({}) as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      }
    )

    expect(response).toEqual({
      success: false,
      error: "Invalid OFFSCREEN_OUTPUT_READY payload",
    })
  })

  it("rejects non-blob browser download URLs before touching downloads", async () => {
    const download = vi.fn(async () => 123)
    const ensureStateManagerInitialized = vi.fn(async () => undefined)
    const updateDownloadTask = vi.fn(async () => undefined)

    vi.stubGlobal("chrome", {
      runtime: { id: "extension-id" },
      downloads: { download, search: vi.fn(async () => []) },
    })

    const response = await handleBackgroundMessage(
      {
        type: "OFFSCREEN_OUTPUT_READY",
        payload: {
          jobId: "job-1",
          attempt: 1,
          outputId: "job-1:archive:0",
          taskId: "task-1",
          chapterId: "chapter-1",
          fileUrl: "https://example.com/file.cbz",
          filename: "Series/Chapter 1.cbz",
          outputIndex: 0,
          outputCount: 1,
          outputKind: "archive",
        },
      } as ExtensionMessage,
      {
        url: "chrome-extension://extension-id/offscreen.html",
      } as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized,
        getStateManager: () =>
          ({ updateDownloadTask }) as unknown as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      }
    )

    expect(response).toEqual({
      success: false,
      error: "Invalid OFFSCREEN_OUTPUT_READY payload",
    })
    expect(ensureStateManagerInitialized).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
    expect(updateDownloadTask).not.toHaveBeenCalled()
  })

  it("suppresses the Save As dialog by default for browser download requests", async () => {
    const download = vi.fn(async () => 123)
    const pendingDownloadsStore = createPendingDownloadsStoreStub()
    const updateDownloadTask = vi.fn(async () => undefined)
    const getGlobalState = vi.fn(async () => ({
      downloadQueue: [
        {
          id: "task-1",
          status: "downloading",
          settingsSnapshot: { overwriteExisting: false },
        },
      ],
    }))

    mocks.settingsGetSettings.mockReset()
    mocks.settingsGetSettings.mockResolvedValue(DEFAULT_SETTINGS)

    vi.stubGlobal("chrome", {
      downloads: { download, search: vi.fn(async () => []) },
    })

    const response = await handleBackgroundMessage(
      {
        type: "OFFSCREEN_OUTPUT_READY",
        payload: {
          jobId: "job-1",
          attempt: 1,
          outputId: "job-1:archive:0",
          taskId: "task-1",
          chapterId: "chapter-1",
          fileUrl: "blob:chrome-extension://abc/file",
          filename: "Series/Chapter 1.cbz",
          outputIndex: 0,
          outputCount: 1,
          outputKind: "archive",
        },
      } as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () =>
          ({
            getGlobalState,
            updateDownloadTask,
          }) as unknown as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore,
        requestBlobRevocation: vi.fn(async () => undefined),
      }
    )

    expect(response).toEqual({ success: true, accepted: true, id: 123 })
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "Series/Chapter 1.cbz",
        saveAs: false,
      })
    )
    expect(pendingDownloadsStore.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        outputId: "job-1:archive:0",
        state: "prepared",
      })
    )
    expect(pendingDownloadsStore.attachDownload).toHaveBeenCalledWith(
      "job-1:archive:0",
      123
    )
  })

  it("finalizes a native download that completes before handoff reconciliation", async () => {
    const download = vi.fn(async () => 321)
    const search = vi.fn(async () => [
      {
        id: 321,
        state: "complete",
        url: "blob:chrome-extension://abc/fast-file",
      },
    ])
    const pendingDownloadsStore = createPendingDownloadsStoreStub()
    const updateDownloadTask = vi.fn(async () => undefined)
    const requestBlobRevocation = vi.fn(async () => undefined)
    const getGlobalState = vi.fn(async () => ({
      downloadQueue: [
        {
          id: "task-1",
          status: "downloading",
          settingsSnapshot: { overwriteExisting: false },
        },
      ],
    }))
    vi.stubGlobal("chrome", {
      downloads: { download, search },
    })

    const response = await handleBackgroundMessage(
      {
        type: "OFFSCREEN_OUTPUT_READY",
        payload: {
          jobId: "job-1",
          attempt: 1,
          outputId: "job-1:archive:0",
          taskId: "task-1",
          chapterId: "chapter-1",
          fileUrl: "blob:chrome-extension://abc/fast-file",
          filename: "Series/Chapter 1.cbz",
          outputIndex: 0,
          outputCount: 1,
          outputKind: "archive",
        },
      } as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () =>
          ({
            getGlobalState,
            updateDownloadTask,
          }) as unknown as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore,
        requestBlobRevocation,
      }
    )

    expect(response).toEqual({ success: true, accepted: true, id: 321 })
    expect(pendingDownloadsStore.markTerminal).toHaveBeenCalledWith(
      321,
      "complete",
      undefined
    )
    expect(updateDownloadTask).toHaveBeenCalledWith("task-1", {
      lastSuccessfulDownloadId: 321,
    })
    expect(requestBlobRevocation).toHaveBeenCalledWith(
      expect.objectContaining({ outputId: "job-1:archive:0" })
    )
    expect(pendingDownloadsStore.markBlobRevoked).toHaveBeenCalledWith(
      "job-1:archive:0"
    )
  })

  it("coalesces duplicate output-ready messages into one Chrome handoff", async () => {
    let acceptDownload: ((downloadId: number) => void) | undefined
    const download = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          acceptDownload = resolve
        })
    )
    const pendingDownloadsStore = createPendingDownloadsStoreStub()
    const getGlobalState = vi.fn(async () => ({
      downloadQueue: [
        {
          id: "task-1",
          status: "downloading",
          settingsSnapshot: { overwriteExisting: false },
        },
      ],
    }))
    vi.stubGlobal("chrome", {
      downloads: { download, search: vi.fn(async () => []) },
    })
    const message = {
      type: "OFFSCREEN_OUTPUT_READY",
      payload: {
        jobId: "job-1",
        attempt: 1,
        outputId: "job-1:archive:0",
        taskId: "task-1",
        chapterId: "chapter-1",
        fileUrl: "blob:chrome-extension://abc/duplicate-file",
        filename: "Series/Chapter 1.cbz",
        outputIndex: 0,
        outputCount: 1,
        outputKind: "archive",
      },
    } as ExtensionMessage
    const dependencies = {
      ensureStateManagerInitialized: vi.fn(async () => undefined),
      getStateManager: () =>
        ({
          getGlobalState,
          updateDownloadTask: vi.fn(async () => undefined),
        }) as unknown as CentralizedStateManager,
      ensureOffscreenDocumentReady: vi.fn(async () => undefined),
      pendingDownloadsStore,
      requestBlobRevocation: vi.fn(async () => undefined),
    }

    const first = handleBackgroundMessage(
      message,
      {} as chrome.runtime.MessageSender,
      dependencies
    )
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    const duplicate = handleBackgroundMessage(
      message,
      {} as chrome.runtime.MessageSender,
      dependencies
    )
    acceptDownload?.(322)

    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      { success: true, accepted: true, id: 322 },
      { success: true, accepted: true, id: 322 },
    ])
    expect(download).toHaveBeenCalledTimes(1)
    expect(pendingDownloadsStore.prepare).toHaveBeenCalledTimes(1)
    expect(pendingDownloadsStore.attachDownload).toHaveBeenCalledTimes(1)
  })

  it("rejects a concurrent output-id collision and revokes only the foreign Blob", async () => {
    let acceptDownload: ((downloadId: number) => void) | undefined
    const download = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          acceptDownload = resolve
        })
    )
    const pendingDownloadsStore = createPendingDownloadsStoreStub()
    const requestBlobRevocation = vi.fn(async () => undefined)
    const getGlobalState = vi.fn(async () => ({
      downloadQueue: [
        {
          id: "task-1",
          status: "downloading",
          settingsSnapshot: { overwriteExisting: false },
        },
      ],
    }))
    vi.stubGlobal("chrome", {
      downloads: { download, search: vi.fn(async () => []) },
    })
    const original = {
      type: "OFFSCREEN_OUTPUT_READY",
      payload: {
        jobId: "job-1",
        attempt: 1,
        outputId: "job-1:archive:0",
        taskId: "task-1",
        chapterId: "chapter-1",
        fileUrl: "blob:chrome-extension://abc/original",
        filename: "Series/Chapter 1.cbz",
        outputIndex: 0,
        outputCount: 1,
        outputKind: "archive",
      },
    } satisfies Extract<ExtensionMessage, { type: "OFFSCREEN_OUTPUT_READY" }>
    const dependencies = {
      ensureStateManagerInitialized: vi.fn(async () => undefined),
      getStateManager: () =>
        ({
          getGlobalState,
          updateDownloadTask: vi.fn(async () => undefined),
        }) as unknown as CentralizedStateManager,
      ensureOffscreenDocumentReady: vi.fn(async () => undefined),
      pendingDownloadsStore,
      requestBlobRevocation,
    }

    const first = handleBackgroundMessage(
      original,
      {} as chrome.runtime.MessageSender,
      dependencies
    )
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    const sameBlobCollision = await handleBackgroundMessage(
      {
        ...original,
        payload: {
          ...original.payload,
          filename: "Series/Different name.cbz",
        },
      } as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      dependencies
    )
    expect(sameBlobCollision).toEqual({
      success: false,
      error: "Output identity collision",
    })
    expect(requestBlobRevocation).not.toHaveBeenCalled()

    const collision = await handleBackgroundMessage(
      {
        ...original,
        payload: {
          ...original.payload,
          fileUrl: "blob:chrome-extension://abc/foreign",
        },
      } as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      dependencies
    )

    expect(collision).toEqual({
      success: false,
      error: "Output identity collision",
    })
    expect(requestBlobRevocation).toHaveBeenCalledWith({
      jobId: "job-1",
      attempt: 1,
      outputId: "job-1:archive:0",
      blobUrl: "blob:chrome-extension://abc/foreign",
    })
    expect(requestBlobRevocation).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledTimes(1)

    acceptDownload?.(323)
    await expect(first).resolves.toEqual({
      success: true,
      accepted: true,
      id: 323,
    })
  })

  it("uses the enqueue-time Chrome Downloads collision policy", async () => {
    const download = vi.fn(async () => 125)
    const getGlobalState = vi.fn(async () => ({
      downloadQueue: [
        {
          id: "task-1",
          status: "downloading",
          settingsSnapshot: { conflictPolicy: "overwrite" },
        },
      ],
    }))
    mocks.settingsGetSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      downloads: {
        ...DEFAULT_SETTINGS.downloads,
        conflictPolicy: "uniquify",
      },
    })
    vi.stubGlobal("chrome", {
      downloads: { download, search: vi.fn(async () => []) },
    })

    await handleBackgroundMessage(
      {
        type: "OFFSCREEN_OUTPUT_READY",
        payload: {
          jobId: "job-1",
          attempt: 1,
          outputId: "job-1:archive:0",
          taskId: "task-1",
          chapterId: "chapter-1",
          fileUrl: "blob:chrome-extension://abc/snapshot",
          filename: "Series/Chapter 1.cbz",
          outputIndex: 0,
          outputCount: 1,
          outputKind: "archive",
        },
      } as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () =>
          ({
            getGlobalState,
            updateDownloadTask: vi.fn(async () => undefined),
          }) as unknown as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      }
    )

    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({ conflictAction: "overwrite" })
    )
  })

  it("rejects native handoffs after the owning task is canceled", async () => {
    const download = vi.fn(async () => 123)
    const requestBlobRevocation = vi.fn(async () => undefined)
    const updateDownloadTask = vi.fn(async () => undefined)
    const getGlobalState = vi.fn(async () => ({
      downloadQueue: [{ id: "task-1", status: "canceled" }],
    }))

    vi.stubGlobal("chrome", {
      downloads: { download, search: vi.fn(async () => []) },
    })

    const response = await handleBackgroundMessage(
      {
        type: "OFFSCREEN_OUTPUT_READY",
        payload: {
          jobId: "job-1",
          attempt: 1,
          outputId: "job-1:archive:0",
          taskId: "task-1",
          chapterId: "chapter-1",
          fileUrl: "blob:chrome-extension://abc/canceled-file",
          filename: "Series/Chapter 1/001.jpg",
          outputIndex: 0,
          outputCount: 1,
          outputKind: "archive",
        },
      } as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () =>
          ({
            getGlobalState,
            updateDownloadTask,
          }) as unknown as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation,
      }
    )

    expect(response).toEqual({
      success: false,
      error: "Download task is no longer active",
    })
    expect(download).not.toHaveBeenCalled()
    expect(updateDownloadTask).not.toHaveBeenCalled()
    expect(requestBlobRevocation).toHaveBeenCalledWith({
      jobId: "job-1",
      attempt: 1,
      outputId: "job-1:archive:0",
      blobUrl: "blob:chrome-extension://abc/canceled-file",
    })
  })

  it("replays an accepted native output after cancellation without revoking its Blob", async () => {
    const blobUrl = "blob:chrome-extension://abc/already-accepted"
    const record = createPendingOutputRecord({
      blobUrl,
      downloadId: 42,
      filename: "Series/Chapter 1.cbz",
    })
    const pendingDownloadsStore = createPendingDownloadsStoreStub([record])
    const download = vi.fn(async () => 999)
    const requestBlobRevocation = vi.fn(async () => undefined)
    vi.stubGlobal("chrome", {
      downloads: {
        download,
        search: vi.fn(async () => [
          { id: 42, state: "in_progress", url: blobUrl },
        ]),
      },
    })

    const response = await handleBackgroundMessage(
      {
        type: "OFFSCREEN_OUTPUT_READY",
        payload: {
          jobId: "job-1",
          attempt: 1,
          outputId: "job-1:archive:0",
          taskId: "task-1",
          chapterId: "chapter-1",
          fileUrl: blobUrl,
          filename: "Series/Chapter 1.cbz",
          outputIndex: 0,
          outputCount: 1,
          outputKind: "archive",
        },
      } as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () =>
          ({
            getGlobalState: vi.fn(async () => ({
              downloadQueue: [{ id: "task-1", status: "canceled" }],
            })),
            updateDownloadTask: vi.fn(async () => undefined),
          }) as unknown as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore,
        requestBlobRevocation,
      }
    )

    expect(response).toEqual({ success: true, accepted: true, id: 42 })
    expect(download).not.toHaveBeenCalled()
    expect(requestBlobRevocation).not.toHaveBeenCalled()
    expect(mocks.activeLeaseGet).not.toHaveBeenCalled()
  })

  it("rejects browser download requests from non-offscreen senders before touching downloads", async () => {
    const download = vi.fn(async () => 123)
    const ensureStateManagerInitialized = vi.fn(async () => undefined)
    const updateDownloadTask = vi.fn(async () => undefined)

    mocks.classifySenderOrigin.mockReturnValueOnce("content-script")

    vi.stubGlobal("chrome", {
      runtime: { id: "extension-id" },
      downloads: { download, search: vi.fn(async () => []) },
    })

    const response = await handleBackgroundMessage(
      {
        type: "OFFSCREEN_OUTPUT_READY",
        payload: {
          jobId: "job-1",
          attempt: 1,
          outputId: "job-1:archive:0",
          taskId: "task-1",
          chapterId: "chapter-1",
          fileUrl: "blob:chrome-extension://extension-id/file",
          filename: "Series/Chapter 1.cbz",
          outputIndex: 0,
          outputCount: 1,
          outputKind: "archive",
        },
      } as ExtensionMessage,
      {
        tab: { id: 11 },
        url: "https://mangadex.org/title/series-1",
      } as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized,
        getStateManager: () =>
          ({ updateDownloadTask }) as unknown as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      }
    )

    expect(response).toEqual({
      success: false,
      error:
        "OFFSCREEN_OUTPUT_READY is only accepted from the offscreen document",
    })
    expect(ensureStateManagerInitialized).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
    expect(updateDownloadTask).not.toHaveBeenCalled()
  })

  it("uses Chrome file chooser when Save As suppression is disabled", async () => {
    const download = vi.fn(async () => 124)
    const updateDownloadTask = vi.fn(async () => undefined)
    const getGlobalState = vi.fn(async () => ({
      downloadQueue: [
        {
          id: "task-1",
          status: "downloading",
          settingsSnapshot: { overwriteExisting: false },
        },
      ],
    }))

    mocks.settingsGetSettings.mockReset()
    mocks.settingsGetSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      downloads: {
        ...DEFAULT_SETTINGS.downloads,
        suppressSaveAsDialog: false,
      },
    })

    vi.stubGlobal("chrome", {
      downloads: { download, search: vi.fn(async () => []) },
    })

    const response = await handleBackgroundMessage(
      {
        type: "OFFSCREEN_OUTPUT_READY",
        payload: {
          jobId: "job-1",
          attempt: 1,
          outputId: "job-1:archive:0",
          taskId: "task-1",
          chapterId: "chapter-1",
          fileUrl: "blob:chrome-extension://abc/file-2",
          filename: "Series/Chapter 2.zip",
          outputIndex: 0,
          outputCount: 1,
          outputKind: "archive",
        },
      } as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () =>
          ({
            getGlobalState,
            updateDownloadTask,
          }) as unknown as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      }
    )

    expect(response).toEqual({ success: true, accepted: true, id: 124 })
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({
        saveAs: true,
      })
    )
  })

  it("rejects CLEAR_ALL_HISTORY from non-options senders before touching state", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: vi.fn(() => "chrome-extension://extension-id/options.html"),
      },
    })

    const ensureStateManagerInitialized = vi.fn(async () => undefined)
    mocks.isSenderFromOptionsPage.mockReturnValue(false)

    const response = await handleBackgroundMessage(
      {
        type: "CLEAR_ALL_HISTORY",
        payload: {},
      } as ExtensionMessage,
      {
        url: "chrome-extension://extension-id/sidepanel.html",
      } as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized,
        getStateManager: () => ({}) as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      }
    )

    expect(response).toEqual({
      success: false,
      error: "CLEAR_ALL_HISTORY is only available from Options page",
    })
    expect(ensureStateManagerInitialized).not.toHaveBeenCalled()
    expect(mocks.clearAllHistory).not.toHaveBeenCalled()
  })

  it("returns the stored site integration enablement map for GET_SITE_INTEGRATION_ENABLEMENT (offscreen proxy)", async () => {
    // The offscreen document cannot read chrome.storage; it proxies through
    // this handler. User-disabled integrations must round-trip intact.
    mocks.enablementServiceGetAll.mockResolvedValueOnce({
      mangadex: false,
      "pixiv-comic": true,
    })

    const response = await handleBackgroundMessage(
      { type: "GET_SITE_INTEGRATION_ENABLEMENT" } as ExtensionMessage,
      {
        url: "chrome-extension://extension-id/offscreen.html",
      } as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () => ({}) as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      }
    )

    expect(mocks.enablementServiceGetAll).toHaveBeenCalledTimes(1)
    expect(response).toEqual({
      success: true,
      enablement: { mangadex: false, "pixiv-comic": true },
    })
  })

  it("returns a structured failure when enablement storage read throws", async () => {
    mocks.enablementServiceGetAll.mockRejectedValueOnce(
      new Error("storage corrupted")
    )

    const response = await handleBackgroundMessage(
      { type: "GET_SITE_INTEGRATION_ENABLEMENT" } as ExtensionMessage,
      {
        url: "chrome-extension://extension-id/offscreen.html",
      } as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () => ({}) as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      }
    )

    expect(response).toEqual({ success: false, error: "storage corrupted" })
  })

  it("rejects offscreen progress messages from non-offscreen senders before touching state", async () => {
    const ensureStateManagerInitialized = vi.fn(async () => undefined)

    mocks.classifySenderOrigin.mockReturnValueOnce("extension-page")

    vi.stubGlobal("chrome", {
      runtime: { id: "extension-id" },
    })

    const response = await handleBackgroundMessage(
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
      {
        url: "chrome-extension://extension-id/sidepanel.html",
      } as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized,
        getStateManager: () => ({}) as CentralizedStateManager,
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      }
    )

    expect(response).toEqual({
      success: false,
      error:
        "OFFSCREEN_DOWNLOAD_PROGRESS is only accepted from the offscreen document",
    })
    expect(ensureStateManagerInitialized).not.toHaveBeenCalled()
    expect(mocks.handleOffscreenDownloadProgress).not.toHaveBeenCalled()
  })
})
