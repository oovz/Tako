import logger from "@/src/runtime/logger"
import {
  siteIntegrationEnablementService,
  type SiteIntegrationEnablementMap,
} from "@/src/storage/site-integration-enablement-service"
import {
  SITE_INTEGRATION_MANIFESTS,
  getSiteIntegrationManifestById,
} from "./manifest"
import { isEnabled } from "./registry"

export const OPTIONAL_BROAD_HTTPS_ORIGIN = "https://*/*"

export function integrationRequiresBroadHttpsPermission(
  integrationId: string
): boolean {
  const manifest = getSiteIntegrationManifestById(integrationId)
  return Boolean(
    manifest?.shipped && manifest.requiresBroadHttpsPermission === true
  )
}

export function enablementRequiresBroadHttpsPermission(
  enablement: SiteIntegrationEnablementMap
): boolean {
  return SITE_INTEGRATION_MANIFESTS.some(
    (manifest) =>
      manifest.requiresBroadHttpsPermission === true &&
      isEnabled(manifest.id, enablement)
  )
}

export function includesBroadHttpsPermission(
  permissions: chrome.permissions.Permissions
): boolean {
  return permissions.origins?.includes(OPTIONAL_BROAD_HTTPS_ORIGIN) ?? false
}

export async function hasBroadHttpsPermission(): Promise<boolean> {
  return chrome.permissions.contains({
    origins: [OPTIONAL_BROAD_HTTPS_ORIGIN],
  })
}

/**
 * Must be called directly from a user gesture. Callers must not await other
 * work before invoking this function or Chrome may reject the request.
 */
export async function requestIntegrationHostPermission(
  integrationId: string
): Promise<boolean> {
  if (!integrationRequiresBroadHttpsPermission(integrationId)) {
    return true
  }

  return chrome.permissions.request({
    origins: [OPTIONAL_BROAD_HTTPS_ORIGIN],
  })
}

export async function removeBroadHttpsPermissionIfUnused(
  enablement: SiteIntegrationEnablementMap
): Promise<boolean> {
  if (enablementRequiresBroadHttpsPermission(enablement)) {
    return false
  }

  if (!(await hasBroadHttpsPermission())) {
    return false
  }

  return chrome.permissions.remove({
    origins: [OPTIONAL_BROAD_HTTPS_ORIGIN],
  })
}

/**
 * Fail closed when a stored integration says it is enabled but its required
 * optional host permission is absent. The explicit false is persisted so all
 * extension contexts converge through the normal storage listener.
 */
export async function reconcileBroadHttpsPermissionEnablement(): Promise<{
  changed: boolean
  enablement: SiteIntegrationEnablementMap
}> {
  const current = await siteIntegrationEnablementService.getAll()
  if (!enablementRequiresBroadHttpsPermission(current)) {
    try {
      await removeBroadHttpsPermissionIfUnused(current)
    } catch (error) {
      // The integration is already disabled. Keep startup available and retry
      // removal on the next reconciliation rather than retaining an error
      // state solely because Chrome rejected optional-permission cleanup.
      logger.warn(
        "Failed to remove unused optional HTTPS host permission",
        error
      )
    }
    return { changed: false, enablement: current }
  }

  if (await hasBroadHttpsPermission()) {
    return { changed: false, enablement: current }
  }

  const next = { ...current }
  let changed = false
  for (const manifest of SITE_INTEGRATION_MANIFESTS) {
    if (
      manifest.requiresBroadHttpsPermission === true &&
      isEnabled(manifest.id, current)
    ) {
      next[manifest.id] = false
      changed = true
    }
  }

  if (changed) {
    await siteIntegrationEnablementService.setAll(next)
    logger.warn(
      "Disabled site integrations whose optional HTTPS host permission is missing"
    )
  }

  return { changed, enablement: next }
}
