/** Background-owned enablement projection and listener. */

import { setEnablementMap } from "@/src/site-integrations/catalog"
import {
  SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY,
  type SiteIntegrationEnablementService,
} from "@/src/storage/site-integration-enablement-service"
import {
  normalizeEnablementMap,
  type SiteIntegrationEnablementMap,
} from "@/src/domain/site-integrations/storage-schemas"
let integrationEnablementInitialized = false
let integrationEnablementInitPromise: Promise<void> | null = null

export type SiteIntegrationEnablementLoader =
  () => Promise<SiteIntegrationEnablementMap>

export function registerSiteIntegrationEnablementListener(
  service: Pick<SiteIntegrationEnablementService, "getAll">
): void {
  void service
  const onChanged = chrome.storage?.onChanged
  if (!onChanged?.addListener) {
    throw new Error(
      "Required extension capability is unavailable: chrome.storage.onChanged"
    )
  }

  onChanged.addListener((changes, areaName) => {
    if (
      areaName !== "local" ||
      !(SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY in changes)
    ) {
      return
    }

    const nextValue: unknown =
      changes[SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY]?.newValue
    setEnablementMap(normalizeEnablementMap(nextValue))
  })
}

export async function initializeSiteIntegrationEnablement(
  loader: SiteIntegrationEnablementLoader
): Promise<void> {
  if (integrationEnablementInitialized) {
    return
  }

  if (integrationEnablementInitPromise) {
    return integrationEnablementInitPromise
  }

  integrationEnablementInitPromise = (async () => {
    const enablement = await loader()
    setEnablementMap(enablement)

    integrationEnablementInitialized = true
  })()

  try {
    await integrationEnablementInitPromise
  } catch (error) {
    integrationEnablementInitPromise = null
    throw error
  }
}
