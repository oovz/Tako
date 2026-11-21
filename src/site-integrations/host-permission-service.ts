import logger from "@/src/runtime/logger"
import type { SiteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"
import type { SiteIntegrationEnablementMap } from "@/src/domain/site-integrations/storage-schemas"
import { siteIntegrationWxtPermissions } from "@/src/runtime/generated/site-integration-wxt-permissions"
import { getDefinitions, getDefinition, isEnabled } from "./catalog"
import {
  MANGADEX_REPORTING_DATA_TYPE,
  includesMangadexReportingPermission,
  type FirefoxPermissions,
} from "./mangadex/report-permission"

export const OPTIONAL_BROAD_HTTPS_ORIGIN = "https://*/*"

export class SeriesHostPermissionRequiredError extends Error {
  constructor(readonly hostname: string) {
    super(`Host access to ${hostname} is required to load this series`)
    this.name = "SeriesHostPermissionRequiredError"
  }
}

function uniqueSorted(origins: Iterable<string>): string[] {
  return [...new Set(origins)].sort()
}

function removableManagedHostOrigins(): Set<string> {
  const manifest = chrome.runtime.getManifest() as chrome.runtime.ManifestV3
  const manifestRequiredOrigins = new Set<string>(
    manifest.host_permissions ?? []
  )
  const manifestOptionalOrigins = new Set<string>(
    manifest.optional_host_permissions ?? []
  )
  return new Set(
    siteIntegrationWxtPermissions.optionalOrigins.filter(
      (origin) =>
        manifestOptionalOrigins.has(origin) &&
        !manifestRequiredOrigins.has(origin)
    )
  )
}

/**
 * Returns the optional host origins that an integration needs when enabled.
 * Disabled providers move their core origins into optional permissions so the
 * production manifest does not grant access before the user enables them.
 */
export function getIntegrationOptionalHostPermissionOrigins(
  integrationId: string
): string[] {
  const definition = getDefinition(integrationId)
  if (!definition?.shipped) return []

  return uniqueSorted([
    ...definition.optionalOrigins,
    ...(definition.enabledByDefault ||
    definition.optionalOrigins.includes(OPTIONAL_BROAD_HTTPS_ORIGIN)
      ? []
      : definition.requiredOrigins),
  ])
}

/**
 * Returns every origin that must be present before an integration can run.
 * Default-enabled providers receive required origins in the manifest; a
 * disabled provider's required origins are requested as optional permissions.
 */
export function getIntegrationHostPermissionOrigins(
  integrationId: string
): string[] {
  const definition = getDefinition(integrationId)
  if (!definition?.shipped) return []

  return uniqueSorted([
    ...(definition.enabledByDefault ? definition.requiredOrigins : []),
    ...getIntegrationOptionalHostPermissionOrigins(integrationId),
  ])
}

export function integrationRequiresOptionalHostPermission(
  integrationId: string
): boolean {
  return getIntegrationOptionalHostPermissionOrigins(integrationId).length > 0
}

function enabledPermissionOrigins(
  enablement: SiteIntegrationEnablementMap
): Set<string> {
  const origins = new Set<string>()
  for (const definition of getDefinitions()) {
    if (!definition.shipped || !isEnabled(definition.id, enablement)) continue

    for (const origin of definition.requiredOrigins) origins.add(origin)
    for (const origin of getIntegrationOptionalHostPermissionOrigins(
      definition.id
    )) {
      origins.add(origin)
    }
  }
  return origins
}

export function includesManagedHostPermission(
  permissions: chrome.permissions.Permissions
): boolean {
  const managedOrigins = removableManagedHostOrigins()
  return (
    permissions.origins?.some((origin) => managedOrigins.has(origin)) ?? false
  )
}

function getIntegrationPermissions(
  integrationId: string,
  origins: string[]
): FirefoxPermissions {
  if (import.meta.env.FIREFOX && integrationId === "mangadex") {
    return { origins, data_collection: [MANGADEX_REPORTING_DATA_TYPE] }
  }
  return { origins }
}

export async function hasIntegrationOptionalHostPermission(
  integrationId: string
): Promise<boolean> {
  const origins = getIntegrationOptionalHostPermissionOrigins(integrationId)
  if (origins.length === 0) return true
  return chrome.permissions.contains(
    getIntegrationPermissions(integrationId, origins)
  )
}

export async function hasIntegrationHostPermission(
  integrationId: string
): Promise<boolean> {
  const origins = getIntegrationHostPermissionOrigins(integrationId)
  if (origins.length === 0) return true
  return chrome.permissions.contains(
    getIntegrationPermissions(integrationId, origins)
  )
}

/**
 * Must be called directly from a user gesture. Callers must not await other
 * work before invoking this function or the browser may reject the request.
 */
export async function requestIntegrationHostPermission(
  integrationId: string
): Promise<boolean> {
  const origins = getIntegrationOptionalHostPermissionOrigins(integrationId)
  if (origins.length === 0) return true

  return chrome.permissions.request(
    getIntegrationPermissions(integrationId, origins)
  )
}

export async function removeUnusedHostPermissions(
  enablement: SiteIntegrationEnablementMap
): Promise<boolean> {
  const managedOrigins = removableManagedHostOrigins()
  const requiredOrigins = enabledPermissionOrigins(enablement)
  const unusedOrigins = [...managedOrigins].filter(
    (origin) => !requiredOrigins.has(origin)
  )
  const removeMangaDexConsent =
    import.meta.env.FIREFOX && !isEnabled("mangadex", enablement)
  if (unusedOrigins.length === 0 && !removeMangaDexConsent) return false

  const grantedPermissions = await chrome.permissions.getAll()
  const grantedOrigins = new Set(grantedPermissions.origins ?? [])
  // Removing an absent wildcard can revoke narrower runtime host grants.
  const removableOrigins = unusedOrigins.filter((origin) =>
    grantedOrigins.has(origin)
  )
  const revokeReporting =
    removeMangaDexConsent &&
    includesMangadexReportingPermission(grantedPermissions)
  if (removableOrigins.length === 0 && !revokeReporting) return false

  const permissions: FirefoxPermissions = {
    origins: removableOrigins,
    ...(revokeReporting && { data_collection: [MANGADEX_REPORTING_DATA_TYPE] }),
  }
  return chrome.permissions.remove(permissions)
}

async function hasOpenOptionsDocument(): Promise<boolean> {
  const optionsUrl = chrome.runtime.getURL("options.html")
  const tabs = await chrome.runtime.getContexts({ contextTypes: ["TAB"] })
  return tabs.some(
    ({ documentUrl }) => documentUrl?.split(/[?#]/, 1)[0] === optionsUrl
  )
}

/**
 * Reconcile persisted enablement with optional permissions during background
 * initialization and after the browser reports a removed grant.
 */
export async function reconcileOptionalHostPermissionEnablement(
  service: Pick<SiteIntegrationEnablementService, "getAll" | "setAll">
): Promise<{
  changed: boolean
  enablement: SiteIntegrationEnablementMap
  disabledIntegrationIds: string[]
}> {
  const current = await service.getAll()
  const next = { ...current }
  const disabledIntegrationIds: string[] = []

  for (const definition of getDefinitions()) {
    if (
      !definition.shipped ||
      !isEnabled(definition.id, current) ||
      !integrationRequiresOptionalHostPermission(definition.id)
    ) {
      continue
    }

    if (await hasIntegrationOptionalHostPermission(definition.id)) continue
    next[definition.id] = false
    disabledIntegrationIds.push(definition.id)
  }

  if (disabledIntegrationIds.length > 0) {
    await service.setAll(next)
    logger.warn(
      "Disabled site integrations whose optional permissions are missing"
    )
  }

  try {
    // An Options draft can hold new grants across a Firefox event-page wake.
    // Options owns unused-grant cleanup while the reader is editing it.
    if (!import.meta.env.FIREFOX || !(await hasOpenOptionsDocument())) {
      await removeUnusedHostPermissions(
        disabledIntegrationIds.length > 0 ? next : current
      )
    }
  } catch (error) {
    logger.warn(
      "Failed to remove unused optional site integration permissions",
      error
    )
  }

  return {
    changed: disabledIntegrationIds.length > 0,
    enablement: next,
    disabledIntegrationIds,
  }
}
