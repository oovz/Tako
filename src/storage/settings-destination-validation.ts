import { t } from "@/src/runtime/i18n"
import {
  loadDownloadRootHandle,
  verifyPermission,
  type DirHandle,
} from "@/src/storage/fs-access"
import { probeDirectory } from "./fs-access-directory-probe"

function isMissingDirectory(error: unknown): error is Error {
  return error instanceof Error && error.name === "NotFoundError"
}

async function deniedDirectoryError(handle: DirHandle): Promise<string> {
  try {
    await probeDirectory(handle)
  } catch (error) {
    if (isMissingDirectory(error)) return t("settings_customFolderNotFound")
  }
  return t("settings_customFolderPermissionDenied")
}

function destinationFailure(error: unknown): { isValid: false; error: string } {
  if (isMissingDirectory(error)) {
    return { isValid: false, error: t("settings_customFolderNotFound") }
  }
  return {
    isValid: false,
    error: t("settings_validateCustomFolderFailed", [
      error instanceof Error ? error.message : t("settings_unknownError"),
    ]),
  }
}

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
    if (!handle || handle.kind !== "directory") {
      return { isValid: false, error: t("settings_customFolderRequired") }
    }
    if (!(await verifyPermission(handle, true))) {
      return {
        isValid: false,
        error: await deniedDirectoryError(handle),
      }
    }
    return { isValid: true }
  } catch (error) {
    return destinationFailure(error)
  }
}
