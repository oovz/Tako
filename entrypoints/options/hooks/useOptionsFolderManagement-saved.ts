import { useEffect, useLayoutEffect, useRef, useState } from "react"
import logger from "@/src/runtime/logger"
import {
  queryFsaPermission,
  readFolderSetupRequired,
  type DirHandle,
} from "@/src/storage/fs-access"
import type { OptionsFsaController } from "../controllers/options-fsa-controller"

export interface SavedFolderOwner {
  controller: OptionsFsaController
  handleId: string | null
  accessRevision: number
}

async function readSavedFolder(
  controller: OptionsFsaController,
  handleId: string | null,
  isCurrent: () => boolean,
  onLoaded: (
    handle: DirHandle | null,
    needsAccess: boolean,
    needsSetup: boolean
  ) => void
): Promise<void> {
  try {
    const handle = await controller.loadSaved(handleId)
    const [permission, needsSetup] = await Promise.all([
      handle ? queryFsaPermission(handle, true) : null,
      handle && handleId ? readFolderSetupRequired(handleId) : false,
    ])
    if (isCurrent())
      onLoaded(handle, handle !== null && permission !== "granted", needsSetup)
  } catch (error) {
    if (!isCurrent()) return
    onLoaded(null, true, false)
    logger.error("[OPTIONS] Failed to load custom folder handle:", error)
  }
}

/** Loading and access renewal share an identity fence, with separate revisions. */
export function useOptionsSavedFolder(
  controller: OptionsFsaController,
  handleId: string | null
) {
  const [savedFolderHandle, setSavedFolderHandle] = useState<DirHandle | null>(
    null
  )
  const [folderAccessRequired, setFolderAccessRequired] = useState(false)
  const [setupHandleId, setSetupHandleId] = useState<string | null>(null)
  const savedFolderOwner = useRef<SavedFolderOwner | null>(null)
  useLayoutEffect(() => {
    savedFolderOwner.current = { controller, handleId, accessRevision: 0 }
    return () => {
      savedFolderOwner.current = null
    }
  }, [controller, handleId])
  useEffect(() => {
    let canceled = false
    const owner = savedFolderOwner.current
    const revision = owner?.accessRevision
    const isCurrent = () =>
      !canceled &&
      savedFolderOwner.current === owner &&
      owner?.accessRevision === revision
    void readSavedFolder(
      controller,
      handleId,
      isCurrent,
      (handle, needsAccess, needsSetup) => {
        setSavedFolderHandle(handle)
        setFolderAccessRequired(needsAccess)
        setSetupHandleId(needsSetup ? handleId : null)
      }
    )
    return () => {
      canceled = true
    }
  }, [controller, handleId])
  return {
    savedFolderHandle,
    setSavedFolderHandle,
    folderAccessRequired,
    folderSetupRequired: handleId !== null && setupHandleId === handleId,
    setFolderAccessRequired,
    savedFolderOwner,
  }
}
