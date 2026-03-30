import { describe, expect, it } from 'vitest'
import {
  mockStorageData,
  siteIntegrationSettingsService,
  siteIntegrationSettingsStorageKey,
} from './site-integration-settings-service-test-setup'

export function registerSiteIntegrationSettingsStorageCases(): void {
  describe('site-integration-settings-service', () => {
    it('returns canonical settings when siteIntegrationSettings exists', async () => {
      expect(siteIntegrationSettingsStorageKey).toBe('siteIntegrationSettings')

      mockStorageData[siteIntegrationSettingsStorageKey] = {
        mangadex: {
          imageQuality: 'data-saver',
        },
      }
      mockStorageData.siteDynamicSettings = {
        mangadex: {
          imageQuality: 'data',
        },
      }

      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({
        mangadex: {
          imageQuality: 'data-saver',
        },
      })
    })

    it('ignores legacy siteDynamicSettings when canonical settings are absent', async () => {
      mockStorageData.siteDynamicSettings = {
        mangadex: {
          autoReadMangaDexSettings: true,
        },
      }

      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({})
      expect(mockStorageData[siteIntegrationSettingsStorageKey]).toBeUndefined()
    })

    it('drops malformed per-site entries while preserving valid site settings', async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = {
        mangadex: {
          imageQuality: 'data',
          autoReadMangaDexSettings: false,
        },
        brokenString: 'bad',
        brokenArray: ['bad'],
      }

      await expect(siteIntegrationSettingsService.getAll()).resolves.toEqual({
        mangadex: {
          imageQuality: 'data',
          autoReadMangaDexSettings: false,
        },
      })
    })
  })
}
