/**
 * Site Integration Settings Service
 * Stores per-site integration-defined settings under 'siteIntegrationSettings'.
 */

import {
  assertValidSettingsFieldValue,
  getSiteIntegrationManifestById,
} from "@/src/site-integrations/manifest"
import { type StorageValue } from "@/src/shared/type-guards"
import { z } from "zod"
import { StorageMutationQueue } from "./storage-mutation-queue"

export type SiteIntegrationSettingValue = StorageValue

export type SiteIntegrationSettingsMap = Record<
  string,
  Record<string, StorageValue>
> // siteId -> { settingId: value }

export const SITE_INTEGRATION_SETTINGS_STORAGE_KEY = "siteIntegrationSettings"

const StorageValueSchema: z.ZodType<StorageValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(StorageValueSchema),
    z.record(z.string(), StorageValueSchema),
  ])
)

const SiteIntegrationSettingsRecordSchema = z.record(
  z.string(),
  StorageValueSchema
)

const StrictSiteIntegrationSettingsMapSchema = z.record(
  z.string(),
  SiteIntegrationSettingsRecordSchema
)

const SiteIntegrationSettingsMapSchema = z
  .record(z.string(), z.unknown())
  .transform((entries) => {
    const normalized: SiteIntegrationSettingsMap = {}
    for (const [siteId, siteSettings] of Object.entries(entries)) {
      const parsed = SiteIntegrationSettingsRecordSchema.safeParse(siteSettings)
      if (parsed.success) {
        normalized[siteId] = parsed.data
      }
    }

    return normalized
  })

function toSiteIntegrationSettingsMap(
  value: unknown
): SiteIntegrationSettingsMap {
  const parsed = SiteIntegrationSettingsMapSchema.safeParse(value)
  if (!parsed.success) return {}

  const normalized: SiteIntegrationSettingsMap = {}
  for (const [siteId, siteSettings] of Object.entries(parsed.data)) {
    const manifest = getSiteIntegrationManifestById(siteId)
    const schemas = new Map(
      (manifest?.customSettings ?? []).map((schema) => [schema.id, schema])
    )
    const validSettings: Record<string, StorageValue> = {}

    for (const [settingId, settingValue] of Object.entries(siteSettings)) {
      const schema = schemas.get(settingId)
      if (!schema) {
        // Unknown integration fields are retained for forward compatibility.
        validSettings[settingId] = settingValue
        continue
      }

      try {
        assertValidSettingsFieldValue(schema, settingValue)
        validSettings[settingId] = settingValue
      } catch {
        // Corrupt or obsolete known values are ignored so Options can recover
        // and project the manifest default instead of failing to load entirely.
      }
    }

    normalized[siteId] = validSettings
  }

  return normalized
}

function assertValidKnownSettings(map: SiteIntegrationSettingsMap): void {
  for (const [siteId, siteSettings] of Object.entries(map)) {
    const manifest = getSiteIntegrationManifestById(siteId)
    const schemas = new Map(
      (manifest?.customSettings ?? []).map((schema) => [schema.id, schema])
    )

    for (const [settingId, settingValue] of Object.entries(siteSettings)) {
      const schema = schemas.get(settingId)
      if (schema) {
        assertValidSettingsFieldValue(schema, settingValue)
      }
    }
  }
}

function getManifestDefaultsForSite(
  siteId: string
): Record<string, StorageValue> {
  const manifest = getSiteIntegrationManifestById(siteId)
  if (!manifest?.customSettings) {
    return {}
  }

  const defaults: Record<string, StorageValue> = {}
  for (const setting of manifest.customSettings) {
    defaults[setting.id] = setting.defaultValue
  }

  return defaults
}

const mutationQueue = new StorageMutationQueue()

async function persistSiteIntegrationSettings(
  map: SiteIntegrationSettingsMap
): Promise<void> {
  const validated = StrictSiteIntegrationSettingsMapSchema.parse(map)
  assertValidKnownSettings(validated)
  await chrome.storage.local.set({
    [SITE_INTEGRATION_SETTINGS_STORAGE_KEY]: validated,
  })
}

export const siteIntegrationSettingsService = {
  async getAll(): Promise<SiteIntegrationSettingsMap> {
    const res = await chrome.storage.local.get(
      SITE_INTEGRATION_SETTINGS_STORAGE_KEY
    )
    return toSiteIntegrationSettingsMap(
      res[SITE_INTEGRATION_SETTINGS_STORAGE_KEY]
    )
  },
  async getForSite(siteId: string): Promise<Record<string, StorageValue>> {
    const all = await this.getAll()
    return {
      ...getManifestDefaultsForSite(siteId),
      ...(all[siteId] || {}),
    }
  },
  async setAll(map: SiteIntegrationSettingsMap): Promise<void> {
    await mutationQueue.run(() => persistSiteIntegrationSettings(map))
  },
  async updateForSite(
    siteId: string,
    updates: Record<string, StorageValue>
  ): Promise<void> {
    await mutationQueue.run(async () => {
      const all = await this.getAll()
      all[siteId] = { ...(all[siteId] || {}), ...updates }
      await persistSiteIntegrationSettings(all)
    })
  },
  async clear(): Promise<void> {
    await mutationQueue.run(() => persistSiteIntegrationSettings({}))
  },
}
