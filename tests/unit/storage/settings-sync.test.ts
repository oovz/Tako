import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsSyncService } from '@/src/storage/settings-sync-service'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import { SETTINGS_STORAGE_KEY } from '@/src/storage/settings-service'
import type { ExtensionSettings } from '@/src/storage/settings-types'

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  loadDownloadRootHandle: vi.fn(),
  verifyPermission: vi.fn(),
  clearDownloadRootHandle: vi.fn(async () => undefined),
  addPersistentError: vi.fn(async () => undefined),
  runtimeSendMessage: vi.fn(),
  storageOnChangedAddListener: vi.fn(),
}))

vi.mock('@/src/storage/settings-service', () => ({
  SETTINGS_STORAGE_KEY: 'settings:canonical-test',
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
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
  applyAdvancedLoggerSettings: vi.fn(),
}))

function mergeSettings(base: ExtensionSettings, updates: Partial<ExtensionSettings>): ExtensionSettings {
  return {
    ...base,
    ...updates,
    downloads: {
      ...base.downloads,
      ...(updates.downloads ?? {}),
    },
    globalPolicy: {
      image: {
        ...base.globalPolicy.image,
        ...(updates.globalPolicy?.image ?? {}),
      },
      chapter: {
        ...base.globalPolicy.chapter,
        ...(updates.globalPolicy?.chapter ?? {}),
      },
    },
    globalRetries: updates.globalRetries ? { ...base.globalRetries, ...updates.globalRetries } : base.globalRetries,
    notifications: typeof updates.notifications === 'boolean' ? updates.notifications : base.notifications,
    advanced: updates.advanced ? { ...base.advanced, ...updates.advanced } : base.advanced,
  }
}

describe('SettingsSyncService behavior', () => {
  let settingsGlobalChangeListener:
    | ((changes: Record<string, chrome.storage.StorageChange>, areaName: chrome.storage.AreaName) => void)
    | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    settingsGlobalChangeListener = undefined

    mocks.storageOnChangedAddListener.mockImplementation(
      (listener: (changes: Record<string, chrome.storage.StorageChange>, areaName: chrome.storage.AreaName) => void) => {
        settingsGlobalChangeListener = listener
      },
    )

    mocks.runtimeSendMessage.mockResolvedValue({ success: true })
    mocks.getSettings.mockResolvedValue(DEFAULT_SETTINGS)
    mocks.updateSettings.mockImplementation(async (updates: Partial<ExtensionSettings>) => mergeSettings(DEFAULT_SETTINGS, updates))
    mocks.loadDownloadRootHandle.mockResolvedValue(undefined)
    mocks.verifyPermission.mockResolvedValue(false)

    vi.stubGlobal('chrome', {
      storage: {
        onChanged: {
          addListener: mocks.storageOnChangedAddListener,
        },
      },
      runtime: {
        sendMessage: mocks.runtimeSendMessage,
      },
    })
  })

  it('sends SYNC_SETTINGS_TO_STATE with updated settings after updateSettingsWithSync succeeds', async () => {
    const service = new SettingsSyncService()

    const result = await service.updateSettingsWithSync({
      downloads: {
        ...DEFAULT_SETTINGS.downloads,
        defaultFormat: 'zip',
        includeComicInfo: false,
      },
    })

    expect(result.success).toBe(true)
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        downloads: expect.objectContaining({
          defaultFormat: 'zip',
          includeComicInfo: false,
        }),
      }),
    )
    expect(mocks.runtimeSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SYNC_SETTINGS_TO_STATE',
        payload: {
          settings: expect.objectContaining({
            downloads: expect.objectContaining({
              defaultFormat: 'zip',
              includeComicInfo: false,
            }),
          }),
        },
      }),
    )
  })

  it('publishes SETTINGS_CHANGED notification and syncs centralized state on settings:global storage changes', () => {
    const service = new SettingsSyncService()
    const listener = vi.fn()
    service.addListener(listener)

    service.initialize()
    expect(mocks.storageOnChangedAddListener).toHaveBeenCalledTimes(1)
    expect(settingsGlobalChangeListener).toBeTypeOf('function')

    const newSettings = mergeSettings(DEFAULT_SETTINGS, {
      downloads: {
        ...DEFAULT_SETTINGS.downloads,
        defaultFormat: 'none',
      },
    })

    settingsGlobalChangeListener?.(
      {
        [SETTINGS_STORAGE_KEY]: {
          oldValue: DEFAULT_SETTINGS,
          newValue: newSettings,
        },
      } as Record<string, chrome.storage.StorageChange>,
      'local',
    )

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SETTINGS_CHANGED',
        settings: expect.objectContaining({
          downloads: expect.objectContaining({ defaultFormat: 'none' }),
        }),
        changedKeys: expect.arrayContaining(['downloads.defaultFormat']),
      }),
    )
    expect(mocks.runtimeSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SYNC_SETTINGS_TO_STATE',
      }),
    )
  })

  it('validates custom mode requires a configured folder handle', async () => {
    const service = new SettingsSyncService()
    mocks.loadDownloadRootHandle.mockResolvedValue(undefined)

    const validation = await service.validateDownloadMode('custom')

    expect(validation).toEqual({
      isValid: false,
      error: 'Custom download mode requires a folder to be selected. Please choose a folder first.',
    })
  })

  it('accepts custom mode when folder handle exists and permission is granted', async () => {
    const service = new SettingsSyncService()
    mocks.loadDownloadRootHandle.mockResolvedValue({} as FileSystemDirectoryHandle)
    mocks.verifyPermission.mockResolvedValue(true)

    const validation = await service.validateDownloadMode('custom')

    expect(validation).toEqual({ isValid: true })
    expect(mocks.verifyPermission).toHaveBeenCalledWith(expect.anything(), true)
  })
})

