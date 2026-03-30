import { describe, expect, it } from 'vitest'
import {
  canonicalStorageKey,
  mockStorageData,
  siteIntegrationEnablementService,
} from './site-integration-enablement-service-test-setup'

export function registerSiteIntegrationEnablementServiceCases(): void {
  describe('site-integration-enablement-service', () => {
    it('stores enablement in the canonical storage key', async () => {
      await siteIntegrationEnablementService.setAll({ mangadex: false })

      expect(mockStorageData[canonicalStorageKey]).toEqual({ mangadex: false })
    })

    it('ignores legacy siteIntegrationOverrides data when canonical enablement is absent', async () => {
      mockStorageData.siteIntegrationOverrides = {
        mangadex: false,
        'pixiv-comic': true,
      }

      await expect(siteIntegrationEnablementService.getAll()).resolves.toEqual({})
      expect(mockStorageData[canonicalStorageKey]).toBeUndefined()
      expect(mockStorageData.siteIntegrationOverrides).toEqual({
        mangadex: false,
        'pixiv-comic': true,
      })
    })

    it('returns canonical enablement data when both canonical and legacy keys exist', async () => {
      mockStorageData[canonicalStorageKey] = {
        mangadex: true,
      }
      mockStorageData.siteIntegrationOverrides = {
        mangadex: false,
      }

      await expect(siteIntegrationEnablementService.getAll()).resolves.toEqual({
        mangadex: true,
      })

      expect(mockStorageData[canonicalStorageKey]).toEqual({
        mangadex: true,
      })
      expect(mockStorageData.siteIntegrationOverrides).toEqual({
        mangadex: false,
      })
    })
  })
}
