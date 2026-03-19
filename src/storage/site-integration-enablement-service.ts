export type SiteIntegrationEnablementMap = Record<string, boolean>

export const SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY = 'siteIntegrationEnablement'

function normalizeEnablementMap(value: unknown): SiteIntegrationEnablementMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const result: SiteIntegrationEnablementMap = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'boolean') {
      result[key] = entry
    }
  }

  return result
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
