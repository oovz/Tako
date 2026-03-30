import { z } from 'zod'

export type SiteIntegrationEnablementMap = Record<string, boolean>

export const SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY = 'siteIntegrationEnablement'

const SiteIntegrationEnablementMapSchema = z.record(z.string(), z.unknown()).transform((entries) => {
  const result: SiteIntegrationEnablementMap = {}
  for (const [key, entry] of Object.entries(entries)) {
    if (typeof entry === 'boolean') {
      result[key] = entry
    }
  }

  return result
})

export function normalizeEnablementMap(value: unknown): SiteIntegrationEnablementMap {
  const parsed = SiteIntegrationEnablementMapSchema.safeParse(value)
  return parsed.success ? parsed.data : {}
}

async function getStoredEnablementMap(): Promise<SiteIntegrationEnablementMap> {
  const result = await chrome.storage.local.get(SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY) as Record<string, unknown>
  return normalizeEnablementMap(result[SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY])
}

export const siteIntegrationEnablementService = {
  async getAll(): Promise<SiteIntegrationEnablementMap> {
    try {
      return await getStoredEnablementMap()
    } catch {
      return {}
    }
  },

  async setAll(overrides: SiteIntegrationEnablementMap): Promise<void> {
    await chrome.storage.local.set({ [SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY]: overrides })
  },

  async setEnabled(siteIntegrationId: string, enabled: boolean): Promise<void> {
    const current = await this.getAll()
    current[siteIntegrationId] = enabled
    await this.setAll(current)
  },

  async clear(): Promise<void> {
    await chrome.storage.local.set({ [SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY]: {} })
  },
}
