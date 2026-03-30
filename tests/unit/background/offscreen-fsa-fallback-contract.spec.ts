import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DestinationService } from '@/entrypoints/background/destination'
import { LOCAL_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  clearDownloadRootHandle: vi.fn(async () => undefined),
  emitError: vi.fn(async () => undefined),
}))

vi.mock('@/src/storage/settings-service', () => ({
  settingsService: {
    getSettings: mocks.getSettings,
    updateSettings: mocks.updateSettings,
  },
}))

vi.mock('@/src/storage/fs-access', () => ({
  loadDownloadRootHandle: vi.fn(),
  clearDownloadRootHandle: mocks.clearDownloadRootHandle,
}))

vi.mock('@/entrypoints/background/errors', () => ({
  addPersistentError: mocks.emitError,
}))

vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

describe('DestinationService fallback behavior', () => {
  const storageLocalSet = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          set: storageLocalSet,
        },
      },
    })
  })

  it('disables custom destination and persists fsaError banner state on fallback', async () => {
    mocks.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      downloads: {
        ...DEFAULT_SETTINGS.downloads,
        downloadMode: 'custom',
        customDirectoryEnabled: true,
        customDirectoryHandleId: 'handle-1',
      },
    })

    const service = new DestinationService()
    await service.clearCustomDirectoryAndFallback('Custom Folder Missing', 'Folder handle disappeared')

    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        downloads: expect.objectContaining({
          downloadMode: 'browser',
          customDirectoryEnabled: false,
          customDirectoryHandleId: null,
        }),
      }),
    )
    expect(mocks.clearDownloadRootHandle).toHaveBeenCalledTimes(1)
    expect(mocks.emitError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'FSA_HANDLE_INVALID',
        severity: 'warning',
      }),
    )
    expect(storageLocalSet).toHaveBeenCalledWith(
      expect.objectContaining({
        [LOCAL_STORAGE_KEYS.fsaError]: expect.objectContaining({
          active: true,
          message: 'Custom Folder Missing: Folder handle disappeared',
        }),
      }),
    )
  })

  it('is a no-op when custom destination is already disabled', async () => {
    mocks.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      downloads: {
        ...DEFAULT_SETTINGS.downloads,
        downloadMode: 'browser',
        customDirectoryEnabled: false,
        customDirectoryHandleId: null,
      },
    })

    const service = new DestinationService()
    await service.clearCustomDirectoryAndFallback('Custom Folder Missing', 'Folder handle disappeared')

    expect(mocks.updateSettings).not.toHaveBeenCalled()
    expect(mocks.clearDownloadRootHandle).not.toHaveBeenCalled()
    expect(mocks.emitError).not.toHaveBeenCalled()
    expect(storageLocalSet).not.toHaveBeenCalled()
  })
})

