import { vi } from 'vitest'

export const mockStorageData: Record<string, unknown> = {}

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

export let siteIntegrationSettingsService: typeof import('@/src/storage/site-integration-settings-service').siteIntegrationSettingsService
export let siteIntegrationSettingsStorageKey: typeof import('@/src/storage/site-integration-settings-service').SITE_INTEGRATION_SETTINGS_STORAGE_KEY

export async function resetSiteIntegrationSettingsServiceTestEnvironment(): Promise<void> {
  vi.clearAllMocks()
  Object.keys(mockStorageData).forEach(key => delete mockStorageData[key])

  vi.resetModules()
  const module = await import('@/src/storage/site-integration-settings-service')
  siteIntegrationSettingsService = module.siteIntegrationSettingsService
  siteIntegrationSettingsStorageKey = module.SITE_INTEGRATION_SETTINGS_STORAGE_KEY
}
