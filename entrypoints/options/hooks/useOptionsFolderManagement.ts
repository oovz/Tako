import { useRef, useState, type RefObject } from "react"
import { toast } from "sonner"
import logger from "@/src/runtime/logger"
import { t } from "@/src/runtime/i18n"
import {
  DOWNLOAD_ROOT_HANDLE_ID,
  type DirHandle,
} from "@/src/storage/fs-access"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import type { OptionsFsaController } from "../controllers/options-fsa-controller"

export interface UseOptionsFolderManagementOptions {
  fsaController: OptionsFsaController
  isSavingRef: RefObject<boolean>
  settingsBuffer: ExtensionSettings | null
  onSettingsChange: (updates: Partial<ExtensionSettings>) => void
}

export function useOptionsFolderManagement(
  options: UseOptionsFolderManagementOptions
) {
  const { fsaController, isSavingRef, settingsBuffer, onSettingsChange } =
    options
  const [savedFolderHandle, setSavedFolderHandle] = useState<DirHandle | null>(
    null
  )
  const [pendingFolderHandle, setPendingFolderHandle] =
    useState<DirHandle | null>(null)
  const [isPickingFolder, setIsPickingFolder] = useState(false)
  const isPickingFolderRef = useRef(false)
  const folderDraftRevisionRef = useRef(0)

  const selectedFolderName =
    pendingFolderHandle?.name ?? savedFolderHandle?.name ?? null

  function getFolderDraftRevision(): number {
    return folderDraftRevisionRef.current
  }

  function bumpFolderDraftRevision(): void {
    folderDraftRevisionRef.current++
  }

  function clearPendingFolder(): void {
    folderDraftRevisionRef.current++
    setPendingFolderHandle(null)
  }

  function beginFolderAction(): boolean {
    if (isSavingRef.current || isPickingFolderRef.current) return false
    isPickingFolderRef.current = true
    setIsPickingFolder(true)
    return true
  }

  function endFolderAction(): void {
    isPickingFolderRef.current = false
    setIsPickingFolder(false)
  }

  async function pickDownloadFolder(): Promise<void> {
    if (!beginFolderAction()) return
    try {
      const result = await fsaController.requestFromUser()
      if (result.status === "unsupported") {
        toast.error(t("options_toastFsaNotSupported"))
        return
      }
      if (result.status === "denied") {
        toast.error(t("options_toastPermissionDenied"))
        return
      }
      if (result.status === "aborted") return
      if (result.status !== "granted") return
      const handle = result.handle

      folderDraftRevisionRef.current++
      setPendingFolderHandle(handle)

      if (settingsBuffer) {
        onSettingsChange({
          downloads: {
            ...settingsBuffer.downloads,
            destination: "file-system-access",
            customDirectoryHandleId: DOWNLOAD_ROOT_HANDLE_ID,
          },
        })
      }

      toast.success(t("options_toastCustomFolderSet", [handle.name]))
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        toast.error(t("options_toastSetFolderFailed"))
      }
    } finally {
      endFolderAction()
    }
  }

  async function repairDownloadFolder(): Promise<boolean> {
    if (!beginFolderAction()) return false
    try {
      const result = await fsaController.requestFromUser()
      if (result.status === "unsupported") {
        toast.error(t("options_toastFsaNotSupported"))
        return false
      }
      if (result.status === "denied") {
        toast.error(t("options_toastPermissionDenied"))
        return false
      }
      if (result.status === "aborted") return false
      if (result.status !== "granted") return false
      const handle = result.handle

      await fsaController.save(handle)
      folderDraftRevisionRef.current++
      setSavedFolderHandle(handle)
      setPendingFolderHandle(null)
      toast.success(t("options_toastCustomFolderSet", [handle.name]))
      return true
    } catch (error) {
      logger.error("[OPTIONS] Failed to repair custom folder:", error)
      toast.error(t("options_toastSetFolderFailed"))
      return false
    } finally {
      endFolderAction()
    }
  }

  async function grantDownloadFolderAccess(): Promise<boolean> {
    if (!beginFolderAction()) return false
    try {
      const result = await fsaController.grantSavedAccess()
      if (result.status === "missing") {
        toast.error(t("settings_customFolderRequired"))
        return false
      }
      if (result.status === "denied") {
        toast.error(t("options_toastPermissionDenied"))
        return false
      }
      const handle = result.handle
      setSavedFolderHandle(handle)
      toast.success(t("destinationIssue_accessGranted"))
      return true
    } catch (error) {
      logger.error("[OPTIONS] Failed to grant custom-folder access:", error)
      toast.error(t("options_toastPermissionDenied"))
      return false
    } finally {
      endFolderAction()
    }
  }

  return {
    savedFolderHandle,
    setSavedFolderHandle,
    pendingFolderHandle,
    setPendingFolderHandle,
    isPickingFolder,
    isPickingFolderRef,
    getFolderDraftRevision,
    bumpFolderDraftRevision,
    clearPendingFolder,
    selectedFolderName,
    pickDownloadFolder,
    repairDownloadFolder,
    grantDownloadFolderAccess,
  }
}
