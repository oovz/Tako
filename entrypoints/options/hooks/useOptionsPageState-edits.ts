import { useCallback, type Dispatch } from "react"
import { toast } from "sonner"
import logger from "@/src/runtime/logger"
import { t } from "@/src/runtime/i18n"
import { getDisplayName } from "@/src/site-integrations/catalog"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import type {
  SiteIntegrationSettingsMap,
  SiteOverrideRecord,
} from "@/src/domain/site-integrations/storage-schemas"
import type { OptionsConfigurationAction } from "../state/options-configuration-reducer"
import type { OptionsHostPermissionController } from "../controllers/options-host-permission-controller"

type ConfigurationDispatch = Dispatch<OptionsConfigurationAction>
type CustomSettingValue = SiteIntegrationSettingsMap[string][string]

async function updateEnablement(
  controller: OptionsHostPermissionController,
  dispatch: ConfigurationDispatch,
  siteIntegrationId: string,
  enabled: boolean
): Promise<void> {
  if (enabled) {
    try {
      // Keep the permission request as the first awaited user-gesture operation.
      const granted = await controller.requestForEnablement(siteIntegrationId)
      if (!granted) {
        toast.error(
          t("options_toastIntegrationHostPermissionDenied", [
            getDisplayName(siteIntegrationId),
          ])
        )
        return
      }
    } catch (error) {
      logger.error(
        `[OPTIONS] Failed to request host permission for ${siteIntegrationId}:`,
        error
      )
      toast.error(
        t("options_toastIntegrationHostPermissionFailed", [
          getDisplayName(siteIntegrationId),
        ])
      )
      return
    }
  }
  dispatch({ type: "set-enablement", siteIntegrationId, enabled })
}

export function useOptionsEdits(
  dispatch: ConfigurationDispatch,
  permissions: OptionsHostPermissionController
) {
  const handleSettingsChange = useCallback(
    (updates: Partial<ExtensionSettings>) =>
      dispatch({ type: "edit-settings", updates }),
    [dispatch]
  )
  return {
    handleSettingsChange,
    handleSiteIntegrationSettingsChange: (
      siteIntegrationId: string,
      settingId: string,
      value: CustomSettingValue | undefined
    ) =>
      dispatch({
        type: "set-integration-setting",
        siteIntegrationId,
        settingId,
        value,
      }),
    handleOverrideChange: (
      siteIntegrationId: string,
      override: SiteOverrideRecord | null
    ) => dispatch({ type: "set-override", siteIntegrationId, override }),
    handleSiteIntegrationEnablementChange: (
      siteIntegrationId: string,
      enabled: boolean
    ) => updateEnablement(permissions, dispatch, siteIntegrationId, enabled),
  }
}
