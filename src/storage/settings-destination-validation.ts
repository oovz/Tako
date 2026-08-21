import { t } from "@/src/runtime/i18n"
import {
  loadDownloadRootHandle,
  verifyPermission,
  type DirHandle,
} from "@/src/storage/fs-access"

export async function validateSettingsDestination(
  destination: string,
  handleOverride?: DirHandle | null
): Promise<{
  isValid: boolean
  error?: string
}> {
  if (destination === "downloads-api") return { isValid: true }
  if (destination !== "file-system-access") {
    return { isValid: false, error: t("settings_invalidDownloadMode") }
  }

  try {
    const handle =
      handleOverride !== undefined
        ? handleOverride
        : await loadDownloadRootHandle()
    if (!handle) {
      return { isValid: false, error: t("settings_customFolderRequired") }
    }
    if (handle.kind !== "directory") {
      return { isValid: false, error: t("settings_customFolderRequired") }
    }
    if (!(await verifyPermission(handle, true))) {
      try {
        if (typeof handle.entries === "function") {
          const entries = handle.entries()
          await entries.next()
        } else if (typeof handle.values === "function") {
          const values = handle.values()
          await values.next()
        }
      } catch (probeError) {
        if (
          probeError instanceof Error &&
          probeError.name === "NotFoundError"
        ) {
          return {
            isValid: false,
            error: t("settings_customFolderNotFound"),
          }
        }
      }
      return {
        isValid: false,
        error: t("settings_customFolderPermissionDenied"),
      }
    }
    return { isValid: true }
  } catch (error) {
    if (error instanceof Error && error.name === "NotFoundError") {
      return {
        isValid: false,
        error: t("settings_customFolderNotFound"),
      }
    }
    return {
      isValid: false,
      error: t("settings_validateCustomFolderFailed", [
        error instanceof Error ? error.message : t("settings_unknownError"),
      ]),
    }
  }
}
