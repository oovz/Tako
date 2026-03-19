import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CentralizedStateManager } from '@/src/runtime/centralized-state'

const mocks = vi.hoisted(() => ({
  initializeSiteIntegrations: vi.fn(async () => undefined),
  getSettings: vi.fn(async () => ({ downloads: { defaultFormat: 'cbz' } })),
  settingsSyncInitialize: vi.fn(),
  validateCustomFolderAccess: vi.fn(async () => ({ isValid: true, shouldFallback: false })),
  createStateManager: vi.fn(),
  initializeFromStorage: vi.fn(async () => ({ queue: [], initFailed: false })),
  processDownloadQueue: vi.fn(async () => undefined),
  hydratePendingDownloads: vi.fn(async () => undefined),
  updateGlobalState: vi.fn(async () => undefined),
}))

vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/src/runtime/site-integration-initialization', () => ({
  initializeSiteIntegrations: mocks.initializeSiteIntegrations,
}))

vi.mock('@/src/storage/settings-service', () => ({
  settingsService: {
    getSettings: mocks.getSettings,
  },
}))

vi.mock('@/src/storage/settings-sync-service', () => ({
  settingsSyncService: {
    initialize: mocks.settingsSyncInitialize,
    validateCustomFolderAccess: mocks.validateCustomFolderAccess,
  },
}))

vi.mock('@/entrypoints/background/state-manager', () => ({
  createStateManager: mocks.createStateManager,
}))

vi.mock('@/entrypoints/background/initialize-from-storage', () => ({
  initializeFromStorage: mocks.initializeFromStorage,
}))

vi.mock('@/entrypoints/background/download-queue', () => ({
  processDownloadQueue: mocks.processDownloadQueue,
}))

describe('initializeBackgroundRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.createStateManager.mockResolvedValue({
      updateGlobalState: mocks.updateGlobalState,
    } satisfies Pick<CentralizedStateManager, 'updateGlobalState'>)
  })

  it('does not eagerly validate custom folder access during startup', async () => {
    const { initializeBackgroundRuntime } = await import('@/entrypoints/background/background-startup')

    const pendingDownloadsStore = {
      hydrate: mocks.hydratePendingDownloads,
    }

    await initializeBackgroundRuntime({
      pendingDownloadsStore: pendingDownloadsStore as never,
      ensureLivenessAlarm: async () => undefined,
      ensureOffscreenDocumentReady: async () => undefined,
    })

    expect(mocks.settingsSyncInitialize).toHaveBeenCalledTimes(1)
    expect(mocks.validateCustomFolderAccess).not.toHaveBeenCalled()
  })
})

