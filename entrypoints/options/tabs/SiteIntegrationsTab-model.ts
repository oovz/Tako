import {
  isEnabled,
  requiresBroadHttpsPermission,
  siteIntegrationCatalog,
} from "@/src/site-integrations/catalog"
import type {
  SiteIntegrationEnablementMap,
  SiteOverrideRecord,
} from "@/src/domain/site-integrations/storage-schemas"
import { hasSiteOverrides } from "../components/SiteIntegrationCard-model"

export type IntegrationFilter = "all" | "enabled" | "disabled" | "overrides"

export function getOverriddenIntegrationIds(
  overrides: Record<string, SiteOverrideRecord>
) {
  return new Set(
    Object.entries(overrides)
      .filter(([, override]) => hasSiteOverrides(override))
      .map(([id]) => id)
  )
}

function matchesIntegrationFilter(
  filter: IntegrationFilter,
  enabled: boolean,
  overridden: boolean
) {
  switch (filter) {
    case "enabled":
      return enabled
    case "disabled":
      return !enabled
    case "overrides":
      return overridden
    case "all":
      return true
  }
}

export function getSiteIntegrationList({
  search,
  filter,
  enablement,
  overriddenIds,
}: {
  search: string
  filter: IntegrationFilter
  enablement: SiteIntegrationEnablementMap
  overriddenIds: ReadonlySet<string>
}) {
  // Catalog metadata is available before asynchronous provider initialization.
  const integrations = siteIntegrationCatalog
    .filter((manifest) => manifest.shipped)
    .map((manifest) => ({
      id: manifest.id,
      name: manifest.name,
      contributors: manifest.contributors,
      domains: manifest.patterns.domains,
      customSettings: manifest.customSettings,
      policyDefaults: manifest.policyDefaults,
      requiresBroadHttpsPermission: requiresBroadHttpsPermission(manifest.id),
      enabled: isEnabled(manifest.id, enablement),
      overridden: overriddenIds.has(manifest.id),
    }))
  const query = search.toLowerCase().trim()
  const visibleIntegrations = integrations
    .filter((integration) => {
      const searchableValues = [
        integration.name,
        ...integration.domains,
        ...(integration.contributors ?? []),
      ]
      return (
        searchableValues.some((value) => value.toLowerCase().includes(query)) &&
        matchesIntegrationFilter(
          filter,
          integration.enabled,
          integration.overridden
        )
      )
    })
    .sort(
      (first, second) =>
        Number(second.overridden) - Number(first.overridden) ||
        first.name.localeCompare(second.name)
    )
  return {
    integrations,
    visibleIntegrations,
    enabledCount: integrations.filter((integration) => integration.enabled)
      .length,
  }
}
