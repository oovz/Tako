import {
  integrationRequiresBroadHttpsPermission,
  removeBroadHttpsPermissionIfUnused,
  requestIntegrationHostPermission,
} from "@/src/site-integrations/host-permission-service"
import type { SiteIntegrationEnablementMap } from "@/src/domain/site-integrations/storage-schemas"

/** Keeps optional host-permission effects outside the Options state reducer. */
export class OptionsHostPermissionController {
  async reconcileOnLoad(): Promise<void> {
    // Optional-host reconciliation is owned by the background composition
    // root. Options only requests/removes permissions for the user's gesture.
  }

  async requestForEnablement(siteIntegrationId: string): Promise<boolean> {
    if (!integrationRequiresBroadHttpsPermission(siteIntegrationId)) {
      return true
    }
    return requestIntegrationHostPermission(siteIntegrationId)
  }

  async removeUnused(enablement: SiteIntegrationEnablementMap): Promise<void> {
    await removeBroadHttpsPermissionIfUnused(enablement)
  }
}
