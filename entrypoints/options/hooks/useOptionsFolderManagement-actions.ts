import { toast } from "sonner"
import logger from "@/src/runtime/logger"
import { t } from "@/src/runtime/i18n"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import type { DirHandle } from "@/src/storage/fs-access"
import type {
  FolderRequestResult,
  FolderAccessResult,
  OptionsFsaController,
} from "../controllers/options-fsa-controller"
import type { SavedFolderOwner } from "./useOptionsFolderManagement-saved"

interface FolderActionLifetime {
  begin: () => boolean
  end: () => void
}
interface PickerOptions extends FolderActionLifetime {
  controller: OptionsFsaController
  settings: ExtensionSettings | null
  setPending: (handle: DirHandle) => void
  onSettingsChange: (updates: Partial<ExtensionSettings>) => void
}

function applyPickedFolder(
  result: FolderRequestResult,
  options: PickerOptions
): void {
  switch (result.status) {
    case "unsupported":
      toast.error(t("options_toastFsaNotSupported"))
      return
    case "denied":
      toast.error(t("options_toastPermissionDenied"))
      return
    case "aborted":
      return
    case "granted":
      options.setPending(result.handle)
      if (options.settings)
        options.onSettingsChange({
          downloads: {
            ...options.settings.downloads,
            destination: "file-system-access",
            customDirectoryHandleId: null,
          },
        })
      toast.success(t("options_toastCustomFolderSet", [result.handle.name]))
  }
}

export async function pickOptionsFolder(options: PickerOptions): Promise<void> {
  if (!options.begin()) return
  try {
    // The picker remains the first awaited browser operation from the gesture.
    applyPickedFolder(await options.controller.requestFromUser(), options)
  } catch (error) {
    if ((error as Error).name !== "AbortError")
      toast.error(t("options_toastSetFolderFailed"))
  } finally {
    options.end()
  }
}

interface GrantOptions extends FolderActionLifetime {
  owner: SavedFolderOwner | null
  controller: OptionsFsaController
  handleId: string | null
  isCurrent: (owner: SavedFolderOwner) => boolean
  onGranted: (handle: DirHandle) => void
}

function applyFolderAccess(
  result: FolderAccessResult,
  owner: SavedFolderOwner,
  onGranted: GrantOptions["onGranted"]
): boolean {
  if (result.status === "missing") {
    toast.error(t("settings_customFolderRequired"))
    return false
  }
  if (result.status === "denied") {
    toast.error(t("options_toastPermissionDenied"))
    return false
  }
  owner.accessRevision++
  onGranted(result.handle)
  toast.success(t("folderAccess_granted"))
  return true
}

function ownsSavedFolder(
  options: GrantOptions
): options is GrantOptions & { owner: SavedFolderOwner } {
  return (
    options.owner !== null &&
    options.owner.controller === options.controller &&
    options.owner.handleId === options.handleId
  )
}

export async function grantOptionsFolderAccess(
  options: GrantOptions
): Promise<boolean> {
  if (!ownsSavedFolder(options)) return false
  const owner = options.owner
  if (!options.begin()) return false
  try {
    const result = await options.controller.grantSavedAccess(options.handleId)
    if (!options.isCurrent(owner)) return false
    return applyFolderAccess(result, owner, options.onGranted)
  } catch (error) {
    if (!options.isCurrent(owner)) return false
    logger.error("[OPTIONS] Failed to grant custom-folder access:", error)
    toast.error(t("options_toastPermissionDenied"))
    return false
  } finally {
    options.end()
  }
}
