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

describe('site-integration-enablement-service', () => {
  let siteIntegrationEnablementService: typeof import('@/src/storage/site-integration-enablement-service').siteIntegrationEnablementService
  let canonicalStorageKey: string

  beforeEach(async () => {
    vi.clearAllMocks()
    Object.keys(mockStorageData).forEach((key) => delete mockStorageData[key])

    vi.resetModules()
    const module = await import('@/src/storage/site-integration-enablement-service')
    siteIntegrationEnablementService = module.siteIntegrationEnablementService
    canonicalStorageKey = module.SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY
  })

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
