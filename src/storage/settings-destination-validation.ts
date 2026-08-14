import { t } from "@/src/runtime/i18n"
import {
  loadDownloadRootHandle,
  verifyPermission,
} from "@/src/storage/fs-access"

export async function validateSettingsDestination(
  destination: string
): Promise<{
  isValid: boolean
  error?: string
}> {
  if (destination === "downloads-api") return { isValid: true }
  if (destination !== "file-system-access") {
    return { isValid: false, error: t("settings_invalidDownloadMode") }
  }

  try {
    const handle = await loadDownloadRootHandle()
    if (!handle) {
      return { isValid: false, error: t("settings_customFolderRequired") }
    }
    if (!(await verifyPermission(handle, true))) {
      return {
        isValid: false,
        error: t("settings_customFolderPermissionDenied"),
      }
    }
    return { isValid: true }
  } catch (error) {
    return {
      isValid: false,
      error: t("settings_validateCustomFolderFailed", [
        error instanceof Error ? error.message : t("settings_unknownError"),
      ]),
    }
  }
}
