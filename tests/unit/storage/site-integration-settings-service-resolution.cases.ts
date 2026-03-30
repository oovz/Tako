import { describe, expect, it } from 'vitest'
import {
  mockStorageData,
  siteIntegrationSettingsService,
  siteIntegrationSettingsStorageKey,
} from './site-integration-settings-service-test-setup'

export function registerSiteIntegrationSettingsResolutionCases(): void {
  describe('site-integration-settings-service', () => {
    it('merges manifest defaults for known integration settings', async () => {
      await expect(siteIntegrationSettingsService.getForSite('mangadex')).resolves.toMatchObject({
        imageQuality: 'data-saver',
        chapterLanguageFilter: [],
        autoReadMangaDexSettings: true,
      })
    })

    it('overrides manifest defaults with stored site-specific values', async () => {
      mockStorageData[siteIntegrationSettingsStorageKey] = {
        mangadex: {
          imageQuality: 'data',
          chapterLanguageFilter: ['ja'],
          autoReadMangaDexSettings: false,
        },
      }

      await expect(siteIntegrationSettingsService.getForSite('mangadex')).resolves.toMatchObject({
        imageQuality: 'data',
        chapterLanguageFilter: ['ja'],
        autoReadMangaDexSettings: false,
      })
    })
  })
}
