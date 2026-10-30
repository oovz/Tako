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
import {
  assertKnownSiteIntegrationIds,
  parseKnownSiteIntegrationDocument,
  readSiteIntegrationDocument,
} from "./site-integration-document-validation"
import { updateSiteIntegrationDocument } from "./site-integration-document-update"

export const SITE_OVERRIDES_STORAGE_KEY = "siteOverrides"

export function parseSiteOverridesDocument(value: unknown): SiteOverridesMap {
  return parseKnownSiteIntegrationDocument(
    SiteOverridesMapSchema,
    value,
    "site overrides"
  )
}

export class SiteOverridesService {
  private readonly mutations = new StorageMutationQueue()

  private async persist(map: SiteOverridesMap): Promise<void> {
    const validated = parseSiteOverridesDocument(map)
    await chrome.storage.local.set({ [SITE_OVERRIDES_STORAGE_KEY]: validated })
  }

  async getAll(): Promise<SiteOverridesMap> {
    return readSiteIntegrationDocument(
      SITE_OVERRIDES_STORAGE_KEY,
      parseSiteOverridesDocument
    )
  }

  async setAll(map: SiteOverridesMap): Promise<void> {
    parseSiteOverridesDocument(map)
    await this.mutations.run(() => this.persist(map))
  }
  async updateForSite(
    siteId: string,
    updates: SiteOverrideRecord
  ): Promise<void> {
    await updateSiteIntegrationDocument(
      siteId,
      updates,
      "site overrides",
      this.mutations,
      () => this.getAll(),
      (map) => this.persist(map)
    )
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
