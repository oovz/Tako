import { useCallback, useRef, useState, type RefObject } from "react"
import type { DirHandle } from "@/src/storage/fs-access"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import type { OptionsFsaController } from "../controllers/options-fsa-controller"
import { useOptionsSavedFolder } from "./useOptionsFolderManagement-saved"
import {
  grantOptionsFolderAccess,
  pickOptionsFolder,
} from "./useOptionsFolderManagement-actions"

export interface UseOptionsFolderManagementOptions {
  fsaController: OptionsFsaController
  isSavingRef: RefObject<boolean>
  savedHandleId: string | null
  settingsBuffer: ExtensionSettings | null
  onSettingsChange: (updates: Partial<ExtensionSettings>) => void
}

function useFolderActionLifetime(isSavingRef: RefObject<boolean>) {
  const [isPickingFolder, setIsPickingFolder] = useState(false)
  const isPickingFolderRef = useRef(false)
  const begin = useCallback(() => {
    if (isSavingRef.current || isPickingFolderRef.current) return false
    isPickingFolderRef.current = true
    setIsPickingFolder(true)
    return true
  }, [isSavingRef])
  const end = useCallback(() => {
    isPickingFolderRef.current = false
    setIsPickingFolder(false)
  }, [])
  return { isPickingFolder, isPickingFolderRef, begin, end }
}

export function useOptionsFolderManagement(
  options: UseOptionsFolderManagementOptions
) {
  const { fsaController, settingsBuffer, onSettingsChange, savedHandleId } =
    options
  const saved = useOptionsSavedFolder(fsaController, savedHandleId)
  const [pendingFolderHandle, setPendingFolderHandle] =
    useState<DirHandle | null>(null)
  const lifetime = useFolderActionLifetime(options.isSavingRef)
  const { begin, end } = lifetime
  const { savedFolderOwner, setSavedFolderHandle, setFolderAccessRequired } =
    saved
  const clearPendingFolder = useCallback(() => setPendingFolderHandle(null), [])
  const pickDownloadFolder = useCallback(
    () =>
      pickOptionsFolder({
        begin,
        end,
        controller: fsaController,
        settings: settingsBuffer,
        onSettingsChange,
        setPending: setPendingFolderHandle,
      }),
    [begin, end, fsaController, settingsBuffer, onSettingsChange]
  )
  const grantDownloadFolderAccess = useCallback(
    () =>
      grantOptionsFolderAccess({
        begin,
        end,
        controller: fsaController,
        handleId: savedHandleId,
        owner: savedFolderOwner.current,
        isCurrent: (owner) => savedFolderOwner.current === owner,
        onGranted: (handle) => {
          setSavedFolderHandle(handle)
          setFolderAccessRequired(false)
        },
      }),
    [
      begin,
      end,
      fsaController,
      savedHandleId,
      savedFolderOwner,
      setSavedFolderHandle,
      setFolderAccessRequired,
    ]
  )
  return {
    savedFolderHandle: saved.savedFolderHandle,
    setSavedFolderHandle,
    pendingFolderHandle,
    setPendingFolderHandle,
    isPickingFolder: lifetime.isPickingFolder,
    isPickingFolderRef: lifetime.isPickingFolderRef,
    clearPendingFolder,
    selectedFolderName:
      pendingFolderHandle?.name ?? saved.savedFolderHandle?.name ?? null,
    folderAccessRequired:
      saved.folderAccessRequired && pendingFolderHandle === null,
    pickDownloadFolder,
    grantDownloadFolderAccess,
  }
}
