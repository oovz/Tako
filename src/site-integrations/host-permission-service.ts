import logger from "@/src/runtime/logger"
import type { SiteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"
import type { SiteIntegrationEnablementMap } from "@/src/domain/site-integrations/storage-schemas"
import { siteIntegrationWxtPermissions } from "@/src/runtime/generated/site-integration-wxt-permissions"
import { getDefinitions, getDefinition, isEnabled } from "./catalog"

export const OPTIONAL_BROAD_HTTPS_ORIGIN = "https://*/*"

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

export async function hasIntegrationOptionalHostPermission(
  integrationId: string
): Promise<boolean> {
  const origins = getIntegrationOptionalHostPermissionOrigins(integrationId)
  if (origins.length === 0) return true
  return chrome.permissions.contains({ origins })
}

export async function hasIntegrationHostPermission(
  integrationId: string
): Promise<boolean> {
  const origins = getIntegrationHostPermissionOrigins(integrationId)
  if (origins.length === 0) return true
  return chrome.permissions.contains({ origins })
}

/**
 * Must be called directly from a user gesture. Callers must not await other
 * work before invoking this function or Chrome may reject the request.
 */
export async function requestIntegrationHostPermission(
  integrationId: string
): Promise<boolean> {
  const origins = getIntegrationOptionalHostPermissionOrigins(integrationId)
  if (origins.length === 0) return true

  return chrome.permissions.request({ origins })
}

export async function removeUnusedHostPermissions(
  enablement: SiteIntegrationEnablementMap
): Promise<boolean> {
  const managedOrigins = removableManagedHostOrigins()
  const requiredOrigins = enabledPermissionOrigins(enablement)
  const removableOrigins = [...managedOrigins].filter(
    (origin) => !requiredOrigins.has(origin)
  )
  if (removableOrigins.length === 0) return false

  return chrome.permissions.remove({ origins: removableOrigins })
}

/**
 * Reconcile persisted enablement with optional host permissions. This runs
 * during background initialization and after Chrome reports a removed grant.
 */
export async function reconcileOptionalHostPermissionEnablement(
  service: Pick<SiteIntegrationEnablementService, "getAll" | "setAll">
): Promise<{
  changed: boolean
  enablement: SiteIntegrationEnablementMap
}> {
  const current = await service.getAll()
  const next = { ...current }
  let changed = false

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
    changed = true
  }

  if (changed) {
    await service.setAll(next)
    logger.warn(
      "Disabled site integrations whose optional host permissions are missing"
    )
  }

  try {
    await removeUnusedHostPermissions(changed ? next : current)
  } catch (error) {
    logger.warn(
      "Failed to remove unused optional site integration host permissions",
      error
    )
  }

  return { changed, enablement: next }
}
