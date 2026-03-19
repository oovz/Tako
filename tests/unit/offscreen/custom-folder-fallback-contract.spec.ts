import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsSyncService } from '@/src/storage/settings-sync-service'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(async () => undefined),
  loadDownloadRootHandle: vi.fn(),
  verifyPermission: vi.fn(),
  clearDownloadRootHandle: vi.fn(async () => undefined),
  addPersistentError: vi.fn(async () => undefined),
}))

vi.mock('@/src/storage/settings-service', () => ({
  settingsService: {
    getSettings: mocks.getSettings,
    updateSettings: mocks.updateSettings,
  },
}))

vi.mock('@/src/storage/fs-access', () => ({
  loadDownloadRootHandle: mocks.loadDownloadRootHandle,
  verifyPermission: mocks.verifyPermission,
  clearDownloadRootHandle: mocks.clearDownloadRootHandle,
}))

vi.mock('@/entrypoints/background/errors', () => ({
  addPersistentError: mocks.addPersistentError,
}))

vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

describe('custom folder fallback contracts (behavior-based)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      downloads: {
        ...DEFAULT_SETTINGS.downloads,
        downloadMode: 'custom',
      },
    })
  })

  it('falls back with explicit missing-handle message when custom folder was cleared', async () => {
    mocks.loadDownloadRootHandle.mockResolvedValue(undefined)

    const service = new SettingsSyncService()
    const result = await service.validateCustomFolderAccess()

    expect(result).toEqual({
      isValid: false,
      shouldFallback: true,
      error: 'Custom folder was cleared. Switched to browser downloads.',
    })
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        downloads: expect.objectContaining({ downloadMode: 'browser' }),
      }),
    )
    expect(mocks.clearDownloadRootHandle).toHaveBeenCalledTimes(1)
    expect(mocks.addPersistentError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'custom-folder-missing',
        message: 'Custom folder was cleared. Switched to browser downloads.',
        severity: 'warning',
      }),
    )
  })

  it('falls back with explicit lost-permission message when custom folder access is lost', async () => {
    mocks.loadDownloadRootHandle.mockResolvedValue({} as FileSystemDirectoryHandle)
    mocks.verifyPermission.mockResolvedValue(false)

    const service = new SettingsSyncService()
    const result = await service.validateCustomFolderAccess()

    expect(result).toEqual({
      isValid: false,
      shouldFallback: true,
      error: 'Lost access to custom folder. Switched to browser downloads.',
    })
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        downloads: expect.objectContaining({ downloadMode: 'browser' }),
      }),
    )
    expect(mocks.clearDownloadRootHandle).toHaveBeenCalledTimes(1)
    expect(mocks.addPersistentError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'custom-folder-permission-lost',
        message: 'Lost access to custom folder. Switched to browser downloads.',
        severity: 'warning',
      }),
    )
  })
})

