import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import { handleBackgroundMessage } from '@/entrypoints/background/background-message-router'
import type { PendingDownloadsStore } from '@/entrypoints/background/pending-downloads'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'
import type { ExtensionMessage } from '@/src/types/extension-messages'

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
  resolveGetTabIdResponse: vi.fn(),
  resolveSourceTabId: vi.fn(),
  isSenderFromOptionsPage: vi.fn(),
  loggerDebug: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('@/src/runtime/logger', () => ({
  default: {
    debug: mocks.loggerDebug,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}))

vi.mock('@/src/storage/settings-service', () => ({
  canonicalizeSettingsDocument: mocks.canonicalizeSettingsDocument,
  settingsService: {
    getSettings: mocks.settingsGetSettings,
  },
}))

vi.mock('@/src/storage/site-integration-enablement-service', () => ({
  siteIntegrationEnablementService: {
    getAll: mocks.enablementServiceGetAll,
  },
}))

vi.mock('@/src/runtime/errors', () => ({
  clearPersistentError: mocks.clearPersistentError,
}))

vi.mock('@/entrypoints/background/download-queue', () => ({
  enqueueStartDownloadTask: mocks.enqueueStartDownloadTask,
  processDownloadQueue: mocks.processDownloadQueue,
  retryFailedChapters: mocks.retryFailedChapters,
  restartTask: mocks.restartTask,
  moveTaskToTop: mocks.moveTaskToTop,
  clearAllHistory: mocks.clearAllHistory,
}))

vi.mock('@/entrypoints/background/state-action-router', () => ({
  processStateAction: mocks.processStateAction,
}))

vi.mock('@/entrypoints/background/offscreen-progress-handler', () => ({
  handleOffscreenDownloadProgress: mocks.handleOffscreenDownloadProgress,
}))

vi.mock('@/src/runtime/background-site-integration-initialization', () => ({
  getBackgroundSiteAdapterById: mocks.getBackgroundSiteAdapterById,
}))

vi.mock('@/entrypoints/background/sender-resolution', () => ({
  resolveGetTabIdResponse: mocks.resolveGetTabIdResponse,
  resolveSourceTabId: mocks.resolveSourceTabId,
  isSenderFromOptionsPage: mocks.isSenderFromOptionsPage,
}))

function createPendingDownloadsStoreStub(): PendingDownloadsStore {
  return {
    hydrate: vi.fn(async () => undefined),
    get: vi.fn(() => undefined),
    set: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    snapshot: vi.fn(() => new Map()),
  }
}

describe('handleBackgroundMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.settingsGetSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mocks.canonicalizeSettingsDocument.mockImplementation((value: unknown) => value)
    mocks.getBackgroundSiteAdapterById.mockResolvedValue(undefined)
    mocks.enablementServiceGetAll.mockResolvedValue({})
  })

  it('syncs centralized state from the authoritative payload without re-reading settings', async () => {
    const syncedSettings = {
      ...DEFAULT_SETTINGS,
      downloads: {
        ...DEFAULT_SETTINGS.downloads,
        defaultFormat: 'zip' as const,
      },
    }
    const updateGlobalState = vi.fn(async () => undefined)
    const ensureStateManagerInitialized = vi.fn(async () => undefined)

    mocks.settingsGetSettings.mockRejectedValueOnce(new Error('stale settings read'))

    const response = await handleBackgroundMessage(
      {
        type: 'SYNC_SETTINGS_TO_STATE',
        payload: { settings: syncedSettings },
      } as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized,
        getStateManager: () => ({ updateGlobalState } as unknown as CentralizedStateManager),
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      },
    )

    expect(response).toEqual({ success: true })
    expect(mocks.settingsGetSettings).not.toHaveBeenCalled()
    expect(ensureStateManagerInitialized).toHaveBeenCalledTimes(1)
    expect(updateGlobalState).toHaveBeenCalledTimes(1)
    expect(updateGlobalState).toHaveBeenCalledWith({ settings: syncedSettings })
  })

  it('rejects malformed SYNC_SETTINGS_TO_STATE payloads before touching state', async () => {
    const ensureStateManagerInitialized = vi.fn(async () => undefined)
    const updateGlobalState = vi.fn(async () => undefined)

    const response = await handleBackgroundMessage(
      {
        type: 'SYNC_SETTINGS_TO_STATE',
        payload: {},
      } as unknown as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized,
        getStateManager: () => ({ updateGlobalState } as unknown as CentralizedStateManager),
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      },
    )

    expect(response).toEqual({ success: false, error: 'Invalid SYNC_SETTINGS_TO_STATE payload' })
    expect(ensureStateManagerInitialized).not.toHaveBeenCalled()
    expect(updateGlobalState).not.toHaveBeenCalled()
  })

  it('rejects malformed STATE_ACTION messages before routing them to the state-action handler', async () => {
    const response = await handleBackgroundMessage(
      {
        type: 'STATE_ACTION',
        payload: { foo: 'bar' },
      } as unknown as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () => ({} as CentralizedStateManager),
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      },
    )

    expect(response).toEqual({ success: false, error: 'Invalid STATE_ACTION message shape' })
    expect(mocks.processStateAction).not.toHaveBeenCalled()
  })

  it('fetches API-backed series data through the background integration runtime', async () => {
    const fetchSeriesMetadata = vi.fn(async () => ({ title: 'Series Title' }))
    const fetchChapterList = vi.fn(async () => ({ chapters: [{ id: 'ch-1', url: 'https://example.com/ch-1', title: 'Chapter 1' }] }))
    mocks.getBackgroundSiteAdapterById.mockResolvedValueOnce({
      id: 'mangadex',
      background: {
        name: 'MangaDex Background',
        series: {
          fetchSeriesMetadata,
          fetchChapterList,
        },
        chapter: {
          processImageUrls: async (urls: string[]) => urls,
          downloadImage: async () => ({ data: new ArrayBuffer(0), filename: 'image.png', mimeType: 'image/png' }),
        },
      },
    })

    const response = await handleBackgroundMessage(
      {
        type: 'FETCH_SERIES_DATA',
        payload: {
          siteIntegrationId: 'mangadex',
          seriesId: 'series-1',
          language: 'en',
        },
      } as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () => ({} as CentralizedStateManager),
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      },
    )

    expect(response).toEqual({
      success: true,
      seriesMetadata: { title: 'Series Title' },
      chapterList: { chapters: [{ id: 'ch-1', url: 'https://example.com/ch-1', title: 'Chapter 1' }] },
      metadataError: undefined,
      chapterListError: undefined,
    })
    expect(mocks.getBackgroundSiteAdapterById).toHaveBeenCalledWith('mangadex')
    expect(fetchSeriesMetadata).toHaveBeenCalledWith('series-1', 'en')
    expect(fetchChapterList).toHaveBeenCalledWith('series-1', 'en')
  })

  it('rejects malformed OFFSCREEN_DOWNLOAD_API_REQUEST payloads before touching downloads', async () => {
    const response = await handleBackgroundMessage(
      {
        type: 'OFFSCREEN_DOWNLOAD_API_REQUEST',
        payload: {
          taskId: 'task-1',
          chapterId: '',
          fileUrl: 'blob:chrome-extension://abc',
          filename: 'Series/Chapter 1.cbz',
        },
      } as unknown as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () => ({} as CentralizedStateManager),
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      },
    )

    expect(response).toEqual({ success: false, error: 'Invalid OFFSCREEN_DOWNLOAD_API_REQUEST payload' })
  })

  it('suppresses the Save As dialog by default for browser download requests', async () => {
    const download = vi.fn(async () => 123)
    const pendingDownloadsStore = createPendingDownloadsStoreStub()
    const updateDownloadTask = vi.fn(async () => undefined)

    mocks.settingsGetSettings.mockReset()
    mocks.settingsGetSettings.mockResolvedValue(DEFAULT_SETTINGS)

    vi.stubGlobal('chrome', {
      downloads: { download },
    })

    const response = await handleBackgroundMessage(
      {
        type: 'OFFSCREEN_DOWNLOAD_API_REQUEST',
        payload: {
          taskId: 'task-1',
          chapterId: 'chapter-1',
          fileUrl: 'blob:chrome-extension://abc/file',
          filename: 'Series/Chapter 1.cbz',
        },
      } as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () => ({ updateDownloadTask } as unknown as CentralizedStateManager),
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore,
        requestBlobRevocation: vi.fn(async () => undefined),
      },
    )

    expect(response).toEqual({ success: true, id: 123 })
    expect(download).toHaveBeenCalledWith(expect.objectContaining({
      filename: 'Series/Chapter 1.cbz',
      saveAs: false,
    }))
    expect(pendingDownloadsStore.set).toHaveBeenCalledWith(123, 'blob:chrome-extension://abc/file')
  })

  it('uses Chrome file chooser when Save As suppression is disabled', async () => {
    const download = vi.fn(async () => 124)
    const updateDownloadTask = vi.fn(async () => undefined)

    mocks.settingsGetSettings.mockReset()
    mocks.settingsGetSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      downloads: {
        ...DEFAULT_SETTINGS.downloads,
        suppressSaveAsDialog: false,
      },
    })

    vi.stubGlobal('chrome', {
      downloads: { download },
    })

    const response = await handleBackgroundMessage(
      {
        type: 'OFFSCREEN_DOWNLOAD_API_REQUEST',
        payload: {
          taskId: 'task-2',
          chapterId: 'chapter-2',
          fileUrl: 'blob:chrome-extension://abc/file-2',
          filename: 'Series/Chapter 2.zip',
        },
      } as ExtensionMessage,
      {} as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () => ({ updateDownloadTask } as unknown as CentralizedStateManager),
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      },
    )

    expect(response).toEqual({ success: true, id: 124 })
    expect(download).toHaveBeenCalledWith(expect.objectContaining({
      saveAs: true,
    }))
  })

  it('rejects CLEAR_ALL_HISTORY from non-options senders before touching state', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        getURL: vi.fn(() => 'chrome-extension://extension-id/options.html'),
      },
    })

    const ensureStateManagerInitialized = vi.fn(async () => undefined)
    mocks.isSenderFromOptionsPage.mockReturnValue(false)

    const response = await handleBackgroundMessage(
      {
        type: 'CLEAR_ALL_HISTORY',
        payload: {},
      } as ExtensionMessage,
      { url: 'chrome-extension://extension-id/sidepanel.html' } as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized,
        getStateManager: () => ({} as CentralizedStateManager),
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      },
    )

    expect(response).toEqual({ success: false, error: 'CLEAR_ALL_HISTORY is only available from Options page' })
    expect(ensureStateManagerInitialized).not.toHaveBeenCalled()
    expect(mocks.clearAllHistory).not.toHaveBeenCalled()
  })

  it('returns the stored site integration enablement map for GET_SITE_INTEGRATION_ENABLEMENT (offscreen proxy)', async () => {
    // The offscreen document cannot read chrome.storage; it proxies through
    // this handler. User-disabled integrations must round-trip intact.
    mocks.enablementServiceGetAll.mockResolvedValueOnce({ mangadex: false, 'pixiv-comic': true })

    const response = await handleBackgroundMessage(
      { type: 'GET_SITE_INTEGRATION_ENABLEMENT' } as ExtensionMessage,
      { url: 'chrome-extension://extension-id/offscreen.html' } as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () => ({} as CentralizedStateManager),
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      },
    )

    expect(mocks.enablementServiceGetAll).toHaveBeenCalledTimes(1)
    expect(response).toEqual({ success: true, enablement: { mangadex: false, 'pixiv-comic': true } })
  })

  it('returns a structured failure when enablement storage read throws', async () => {
    mocks.enablementServiceGetAll.mockRejectedValueOnce(new Error('storage corrupted'))

    const response = await handleBackgroundMessage(
      { type: 'GET_SITE_INTEGRATION_ENABLEMENT' } as ExtensionMessage,
      { url: 'chrome-extension://extension-id/offscreen.html' } as chrome.runtime.MessageSender,
      {
        ensureStateManagerInitialized: vi.fn(async () => undefined),
        getStateManager: () => ({} as CentralizedStateManager),
        ensureOffscreenDocumentReady: vi.fn(async () => undefined),
        pendingDownloadsStore: createPendingDownloadsStoreStub(),
        requestBlobRevocation: vi.fn(async () => undefined),
      },
    )

    expect(response).toEqual({ success: false, error: 'storage corrupted' })
  })
})
