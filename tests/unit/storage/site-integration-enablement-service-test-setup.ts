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

export let siteIntegrationEnablementService: typeof import('@/src/storage/site-integration-enablement-service').siteIntegrationEnablementService
export let canonicalStorageKey: string

export async function resetSiteIntegrationEnablementServiceTestEnvironment(): Promise<void> {
  vi.clearAllMocks()
  Object.keys(mockStorageData).forEach(key => delete mockStorageData[key])

  vi.resetModules()
  const module = await import('@/src/storage/site-integration-enablement-service')
  siteIntegrationEnablementService = module.siteIntegrationEnablementService
  canonicalStorageKey = module.SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY
}
