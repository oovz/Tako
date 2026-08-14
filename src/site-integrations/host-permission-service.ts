import logger from "@/src/runtime/logger"
import type { SiteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"
import type { SiteIntegrationEnablementMap } from "@/src/domain/site-integrations/storage-schemas"
import {
  getDefinitions,
  isEnabled,
  requiresBroadHttpsPermission,
} from "./catalog"

export const OPTIONAL_BROAD_HTTPS_ORIGIN = "https://*/*"

export function integrationRequiresBroadHttpsPermission(
  integrationId: string
): boolean {
  return requiresBroadHttpsPermission(integrationId)
}

export function enablementRequiresBroadHttpsPermission(
  enablement: SiteIntegrationEnablementMap
): boolean {
  return getDefinitions().some(
    (definition) =>
      requiresBroadHttpsPermission(definition.id) &&
      isEnabled(definition.id, enablement)
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
export async function reconcileBroadHttpsPermissionEnablement(
  service: Pick<SiteIntegrationEnablementService, "getAll" | "setAll">
): Promise<{
  changed: boolean
  enablement: SiteIntegrationEnablementMap
}> {
  const current = await service.getAll()
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
  for (const manifest of getDefinitions()) {
    if (
      requiresBroadHttpsPermission(manifest.id) &&
      isEnabled(manifest.id, current)
    ) {
      next[manifest.id] = false
      changed = true
    }
  }

  if (changed) {
    await service.setAll(next)
    logger.warn(
      "Disabled site integrations whose optional HTTPS host permission is missing"
    )
  }

  return { changed, enablement: next }
}
