import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockStorageData: Record<string, unknown> = {}

globalThis.chrome = {
  storage: {
    local: {
      async get(keys: string | string[]) {
        const keyArray = Array.isArray(keys) ? keys : [keys]
        const result: Record<string, unknown> = {}
        for (const key of keyArray) {
          if (key in mockStorageData) {
            result[key] = mockStorageData[key]
          }
        }
        return result
      },
      async set(items: Record<string, unknown>) {
        Object.assign(mockStorageData, items)
      },
      async remove(keys: string | string[]) {
        const keyArray = Array.isArray(keys) ? keys : [keys]
        for (const key of keyArray) {
          delete mockStorageData[key]
        }
      },
    },
  },
} as typeof chrome

describe('site-integration-settings-service', () => {
  let siteIntegrationSettingsService: typeof import('@/src/storage/site-integration-settings-service').siteIntegrationSettingsService
  let siteIntegrationSettingsStorageKey: typeof import('@/src/storage/site-integration-settings-service').SITE_INTEGRATION_SETTINGS_STORAGE_KEY

  beforeEach(async () => {
    vi.clearAllMocks()
    Object.keys(mockStorageData).forEach((key) => delete mockStorageData[key])

    vi.resetModules()
    const module = await import('@/src/storage/site-integration-settings-service')
    siteIntegrationSettingsService = module.siteIntegrationSettingsService
    siteIntegrationSettingsStorageKey = module.SITE_INTEGRATION_SETTINGS_STORAGE_KEY
  })

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
