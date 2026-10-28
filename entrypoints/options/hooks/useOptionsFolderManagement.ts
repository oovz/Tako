import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { toast } from "sonner"
import logger from "@/src/runtime/logger"
import { t } from "@/src/runtime/i18n"
import { queryFsaPermission, type DirHandle } from "@/src/storage/fs-access"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import type { OptionsFsaController } from "../controllers/options-fsa-controller"

export interface UseOptionsFolderManagementOptions {
  fsaController: OptionsFsaController
  isSavingRef: RefObject<boolean>
  savedHandleId: string | null
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
  const [folderAccessRequired, setFolderAccessRequired] = useState(false)
  const [pendingFolderHandle, setPendingFolderHandle] =
    useState<DirHandle | null>(null)
  const [isPickingFolder, setIsPickingFolder] = useState(false)
  const isPickingFolderRef = useRef(false)

  useEffect(() => {
    let canceled = false
    const revision = fsaController.revision
    void fsaController
      .loadSaved(options.savedHandleId)
      .then(async (handle) => {
        const permission = handle
          ? await queryFsaPermission(handle, true)
          : null
        if (canceled || fsaController.revision !== revision) return
        setSavedFolderHandle(handle)
        setFolderAccessRequired(handle !== null && permission !== "granted")
      })
      .catch((error) => {
        if (canceled || fsaController.revision !== revision) return
        setSavedFolderHandle(null)
        setFolderAccessRequired(true)
        logger.error("[OPTIONS] Failed to load custom folder handle:", error)
      })
    return () => {
      canceled = true
    }
  }, [fsaController, options.savedHandleId])

  const selectedFolderName =
    pendingFolderHandle?.name ?? savedFolderHandle?.name ?? null

  const clearPendingFolder = useCallback((): void => {
    setPendingFolderHandle(null)
  }, [])

  const beginFolderAction = useCallback((): boolean => {
    if (isSavingRef.current || isPickingFolderRef.current) return false
    isPickingFolderRef.current = true
    setIsPickingFolder(true)
    return true
  }, [isSavingRef])

  const endFolderAction = useCallback((): void => {
    isPickingFolderRef.current = false
    setIsPickingFolder(false)
  }, [])

  const pickDownloadFolder = useCallback(async (): Promise<void> => {
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

      setPendingFolderHandle(handle)

      if (settingsBuffer) {
        onSettingsChange({
          downloads: {
            ...settingsBuffer.downloads,
            destination: "file-system-access",
            customDirectoryHandleId: null,
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
  }, [
    beginFolderAction,
    endFolderAction,
    fsaController,
    onSettingsChange,
    settingsBuffer,
  ])

  const repairDownloadFolder = useCallback(async (): Promise<boolean> => {
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

      await fsaController.repair(handle)
      setSavedFolderHandle(handle)
      setFolderAccessRequired(false)
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
  }, [beginFolderAction, endFolderAction, fsaController])

  const grantDownloadFolderAccess = useCallback(async (): Promise<boolean> => {
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
      setFolderAccessRequired(false)
      toast.success(t("destinationIssue_accessGranted"))
      return true
    } catch (error) {
      logger.error("[OPTIONS] Failed to grant custom-folder access:", error)
      toast.error(t("options_toastPermissionDenied"))
      return false
    } finally {
      endFolderAction()
    }
  }, [beginFolderAction, endFolderAction, fsaController])

  return {
    savedFolderHandle,
    setSavedFolderHandle,
    pendingFolderHandle,
    setPendingFolderHandle,
    isPickingFolder,
    isPickingFolderRef,
    clearPendingFolder,
    selectedFolderName,
    folderAccessRequired: folderAccessRequired && pendingFolderHandle === null,
    pickDownloadFolder,
    repairDownloadFolder,
    grantDownloadFolderAccess,
  }
}
