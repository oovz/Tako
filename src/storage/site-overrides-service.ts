/**
 * Site Overrides Service
 * Stores per-site overrides in chrome.storage.local under key 'siteOverrides'.
 *
 * Flat structure of current per-provider queue policy overrides:
 *   { [siteId]: {
 *       imagePolicy?: { concurrency?: number, delayMs?: number },
 *       chapterPolicy?: { concurrency?: number, delayMs?: number },
 *       retries?: { image?: number, chapter?: number }
 *   } }
 */

import { StorageMutationQueue } from "./storage-mutation-queue"
import {
  SiteOverridesMapSchema,
  type SiteOverrideRecord,
  type SiteOverridesMap,
} from "@/src/domain/site-integrations/storage-schemas"
import { assertKnownSiteIntegrationIds } from "./site-integration-document-validation"

export const SITE_OVERRIDES_STORAGE_KEY = "siteOverrides"

export function parseSiteOverridesDocument(value: unknown): SiteOverridesMap {
  const parsed = SiteOverridesMapSchema.parse(value)
  assertKnownSiteIntegrationIds(parsed, "site overrides")
  return parsed
}

export class SiteOverridesService {
  private readonly mutations = new StorageMutationQueue()

  private async persist(map: SiteOverridesMap): Promise<void> {
    const validated = parseSiteOverridesDocument(map)
    await chrome.storage.local.set({ [SITE_OVERRIDES_STORAGE_KEY]: validated })
  }

  async getAll(): Promise<SiteOverridesMap> {
    const res = await chrome.storage.local.get(SITE_OVERRIDES_STORAGE_KEY)
    if (!(SITE_OVERRIDES_STORAGE_KEY in res)) return {}
    return parseSiteOverridesDocument(res[SITE_OVERRIDES_STORAGE_KEY])
  }

  async setAll(map: SiteOverridesMap): Promise<void> {
    parseSiteOverridesDocument(map)
    await this.mutations.run(() => this.persist(map))
  }
  async updateForSite(
    siteId: string,
    updates: SiteOverrideRecord
  ): Promise<void> {
    assertKnownSiteIntegrationIds({ [siteId]: {} }, "site overrides")
    await this.mutations.run(async () => {
      const current = await this.getAll()
      current[siteId] = { ...(current[siteId] || {}), ...updates }
      await this.persist(current)
    })
  }
  async removeSite(siteId: string): Promise<void> {
    assertKnownSiteIntegrationIds({ [siteId]: {} }, "site overrides")
    await this.mutations.run(async () => {
      const current = await this.getAll()
      if (current[siteId]) {
        delete current[siteId]
        await this.persist(current)
      }
    })
  }
  async clear(): Promise<void> {
    await this.mutations.run(() => this.persist({}))
  }
}
