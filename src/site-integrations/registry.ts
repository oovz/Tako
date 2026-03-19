import {
  SITE_INTEGRATION_MANIFESTS,
  getSiteIntegrationManifestById,
  type SiteIntegrationManifest,
} from './manifest'

export { SITE_INTEGRATION_MANIFESTS }

export type SiteIntegrationEnablementMap = Record<string, boolean>

let userSiteIntegrationEnablement: SiteIntegrationEnablementMap = {}

export function getManifest(id: string): SiteIntegrationManifest | null {
  return getSiteIntegrationManifestById(id) ?? null
}

export function getUserSiteIntegrationEnablement(): SiteIntegrationEnablementMap {
  return { ...userSiteIntegrationEnablement }
}

export function setUserSiteIntegrationEnablement(enablement: SiteIntegrationEnablementMap): void {
  userSiteIntegrationEnablement = { ...enablement }
}

export function isEnabled(
  id: string,
  enablement: SiteIntegrationEnablementMap = userSiteIntegrationEnablement,
): boolean {
  const manifest = getManifest(id)
  if (!manifest) {
    return false
  }

  if (manifest.enabled === false) {
    return false
  }

  const overrideValue = enablement[id]
  if (typeof overrideValue === 'boolean') {
    return overrideValue
  }

  return true
}
