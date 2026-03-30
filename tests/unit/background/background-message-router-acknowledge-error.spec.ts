import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleBackgroundMessage } from '@/entrypoints/background/background-message-router'
import type { PendingDownloadsStore } from '@/entrypoints/background/pending-downloads'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'
import type { ExtensionMessage } from '@/src/types/extension-messages'

const mocks = vi.hoisted(() => ({
  clearPersistentError: vi.fn(),
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
  canonicalizeSettingsDocument: vi.fn(),
  settingsService: {
    getSettings: vi.fn(),
  },
}))

vi.mock('@/entrypoints/background/errors', () => ({
  clearPersistentError: mocks.clearPersistentError,
}))

vi.mock('@/entrypoints/background/download-queue', () => ({
  enqueueStartDownloadTask: vi.fn(),
  processDownloadQueue: vi.fn(),
  retryFailedChapters: vi.fn(),
  restartTask: vi.fn(),
  moveTaskToTop: vi.fn(),
  clearAllHistory: vi.fn(),
}))

vi.mock('@/entrypoints/background/state-action-router', () => ({
  processStateAction: vi.fn(),
}))

vi.mock('@/entrypoints/background/offscreen-progress-handler', () => ({
  handleOffscreenDownloadProgress: vi.fn(),
}))

vi.mock('@/entrypoints/background/sender-resolution', () => ({
  resolveGetTabIdResponse: vi.fn(),
  resolveSourceTabId: vi.fn(),
  isSenderFromOptionsPage: vi.fn(),
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

describe('handleBackgroundMessage ACKNOWLEDGE_ERROR validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
        },
      },
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      },
    } as unknown as typeof chrome)
  })

  it('rejects malformed ACKNOWLEDGE_ERROR payloads before clearing persistent errors', async () => {
    const response = await handleBackgroundMessage(
      {
        type: 'ACKNOWLEDGE_ERROR',
        payload: {},
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

    expect(response).toEqual({ success: false, error: 'Invalid ACKNOWLEDGE_ERROR payload' })
    expect(mocks.clearPersistentError).not.toHaveBeenCalled()
  })
})
