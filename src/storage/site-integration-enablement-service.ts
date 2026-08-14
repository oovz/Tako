import { StorageMutationQueue } from "./storage-mutation-queue"
import {
  SiteIntegrationEnablementMapSchema,
  type SiteIntegrationEnablementMap,
} from "@/src/domain/site-integrations/storage-schemas"
import { assertKnownSiteIntegrationIds } from "./site-integration-document-validation"

export const SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY =
  "siteIntegrationEnablement"

export function parseSiteIntegrationEnablementDocument(
  value: unknown
): SiteIntegrationEnablementMap {
  const parsed = SiteIntegrationEnablementMapSchema.parse(value)
  assertKnownSiteIntegrationIds(parsed, "site integration enablement")
  return parsed
}

export class SiteIntegrationEnablementService {
  private readonly mutations = new StorageMutationQueue()

  private async getStored(): Promise<SiteIntegrationEnablementMap> {
    const result = await chrome.storage.local.get(
      SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY
    )
    if (!(SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY in result)) return {}
    return parseSiteIntegrationEnablementDocument(
      result[SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY]
    )
  }

  private async persist(map: SiteIntegrationEnablementMap): Promise<void> {
    const validated = parseSiteIntegrationEnablementDocument(map)
    await chrome.storage.local.set({
      [SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY]: validated,
    })
  }

  async getAll(): Promise<SiteIntegrationEnablementMap> {
    return this.getStored()
  }

  async setAll(overrides: SiteIntegrationEnablementMap): Promise<void> {
    parseSiteIntegrationEnablementDocument(overrides)
    await this.mutations.run(() => this.persist(overrides))
  }

  async setEnabled(siteIntegrationId: string, enabled: boolean): Promise<void> {
    assertKnownSiteIntegrationIds(
      { [siteIntegrationId]: true },
      "site integration enablement"
    )
    await this.mutations.run(async () => {
      const current = await this.getAll()
      current[siteIntegrationId] = enabled
      await this.persist(current)
    })
  }

  async clear(): Promise<void> {
    await this.mutations.run(() => this.persist({}))
  }
}
