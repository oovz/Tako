import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import { handleBackgroundMessage } from '@/entrypoints/background/background-message-router'
import type { PendingDownloadsStore } from '@/entrypoints/background/pending-downloads'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'
import type { ExtensionMessage } from '@/src/types/extension-messages'

const mocks = vi.hoisted(() => ({
  settingsGetSettings: vi.fn(),
  canonicalizeSettingsDocument: vi.fn(),
  clearPersistentError: vi.fn(),
  enqueueStartDownloadTask: vi.fn(),
  processDownloadQueue: vi.fn(),
  retryFailedChapters: vi.fn(),
  restartTask: vi.fn(),
  moveTaskToTop: vi.fn(),
  clearAllHistory: vi.fn(),
  processStateAction: vi.fn(),
  handleOffscreenDownloadProgress: vi.fn(),
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

vi.mock('@/entrypoints/background/errors', () => ({
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
})
