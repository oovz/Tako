import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react"
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
  const savedFolderOwner = useRef<{
    controller: OptionsFsaController
    handleId: string | null
    accessRevision: number
  } | null>(null)

  useLayoutEffect(() => {
    const owner = {
      controller: fsaController,
      handleId: options.savedHandleId,
      accessRevision: 0,
    }
    savedFolderOwner.current = owner
    return () => {
      savedFolderOwner.current = null
    }
  }, [fsaController, options.savedHandleId])

  useEffect(() => {
    let canceled = false
    const owner = savedFolderOwner.current
    const revision = owner?.accessRevision
    const isCurrent = () =>
      !canceled &&
      savedFolderOwner.current === owner &&
      owner?.accessRevision === revision
    void fsaController
      .loadSaved(options.savedHandleId)
      .then(async (handle) => {
        const permission = handle
          ? await queryFsaPermission(handle, true)
          : null
        if (!isCurrent()) return
        setSavedFolderHandle(handle)
        setFolderAccessRequired(handle !== null && permission !== "granted")
      })
      .catch((error) => {
        if (!isCurrent()) return
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

  const grantDownloadFolderAccess = useCallback(async (): Promise<boolean> => {
    const owner = savedFolderOwner.current
    if (
      !owner ||
      owner.controller !== fsaController ||
      owner.handleId !== options.savedHandleId
    )
      return false
    if (!beginFolderAction()) return false
    try {
      const result = await fsaController.grantSavedAccess(options.savedHandleId)
      if (savedFolderOwner.current !== owner) return false
      if (result.status === "missing") {
        toast.error(t("settings_customFolderRequired"))
        return false
      }
      if (result.status === "denied") {
        toast.error(t("options_toastPermissionDenied"))
        return false
      }
      const handle = result.handle
      owner.accessRevision++
      setSavedFolderHandle(handle)
      setFolderAccessRequired(false)
      toast.success(t("folderAccess_granted"))
      return true
    } catch (error) {
      if (savedFolderOwner.current !== owner) return false
      logger.error("[OPTIONS] Failed to grant custom-folder access:", error)
      toast.error(t("options_toastPermissionDenied"))
      return false
    } finally {
      endFolderAction()
    }
  }, [beginFolderAction, endFolderAction, fsaController, options.savedHandleId])

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
    grantDownloadFolderAccess,
  }
}
