import { backgroundSiteAdaptersById } from "@/src/runtime/generated/site-integration-background-registry"
import {
  getDefinition,
  getDefinitions,
  isEnabled,
} from "@/src/site-integrations/catalog"
import type { BackgroundSiteAdapter } from "@/src/types/site-integrations"

function resolveEnabledAdapter(
  siteIntegrationId: string
): BackgroundSiteAdapter | undefined {
  const definition = getDefinition(siteIntegrationId)
  if (!definition?.shipped || !isEnabled(siteIntegrationId)) return undefined
  return backgroundSiteAdaptersById[siteIntegrationId]
}

/**
 * Resolve the statically packaged provider adapter. There is no runtime
 * registration or metadata merge: the generated map is authoritative.
 */
export function getBackgroundSiteAdapterById(
  siteIntegrationId: string
): Promise<BackgroundSiteAdapter | undefined> {
  return Promise.resolve(resolveEnabledAdapter(siteIntegrationId))
}

/** Validate that every enabled shipped provider has its generated adapter. */
export function validateBackgroundSiteIntegrations(): void {
  for (const definition of getDefinitions()) {
    if (!definition.shipped || !isEnabled(definition.id)) continue
    if (!backgroundSiteAdaptersById[definition.id]) {
      throw new Error(
        `Missing generated background adapter for ${definition.id}`
      )
    }
  }
}
