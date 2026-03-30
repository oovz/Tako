import { describe, expect, it, vi } from 'vitest'
import { SettingsSyncService } from '@/src/storage/settings-sync-service'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'
import { SETTINGS_STORAGE_KEY } from '@/src/storage/settings-service'
import { mergeSettings, mocks, settingsGlobalChangeListener } from './settings-sync-test-setup'

export function registerSettingsSyncStateCases(): void {
  describe('SettingsSyncService behavior', () => {
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
        })
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
        })
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
        'local'
      )

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SETTINGS_CHANGED',
          settings: expect.objectContaining({
            downloads: expect.objectContaining({ defaultFormat: 'none' }),
          }),
          changedKeys: expect.arrayContaining(['downloads.defaultFormat']),
        })
      )
      expect(mocks.runtimeSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SYNC_SETTINGS_TO_STATE',
        })
      )
    })

    it('canonicalizes partial settings storage changes before notifying listeners and syncing state', () => {
      const service = new SettingsSyncService()
      const listener = vi.fn()
      service.addListener(listener)

      service.initialize()

      settingsGlobalChangeListener?.(
        {
          [SETTINGS_STORAGE_KEY]: {
            oldValue: {
              downloads: {
                defaultFormat: 'cbz',
              },
            },
            newValue: {
              downloads: {
                defaultFormat: 'none',
              },
            },
          },
        } as Record<string, chrome.storage.StorageChange>,
        'local'
      )

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SETTINGS_CHANGED',
          settings: expect.objectContaining({
            downloads: expect.objectContaining({
              defaultFormat: 'none',
              pathTemplate: DEFAULT_SETTINGS.downloads.pathTemplate,
            }),
            globalPolicy: DEFAULT_SETTINGS.globalPolicy,
          }),
          changedKeys: expect.arrayContaining(['downloads.defaultFormat']),
        })
      )

      expect(mocks.runtimeSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SYNC_SETTINGS_TO_STATE',
          payload: {
            settings: expect.objectContaining({
              downloads: expect.objectContaining({
                defaultFormat: 'none',
                pathTemplate: DEFAULT_SETTINGS.downloads.pathTemplate,
              }),
            }),
          },
        })
      )
    })
  })
}
