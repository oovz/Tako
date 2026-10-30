import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import logger from "@/src/runtime/logger"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { OptionsDownloadState } from "@/src/runtime/runtime-message-contracts"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import type { StorageReadStatus } from "@/src/ui/shared/hooks/useChromeStorageValue"

const EMPTY_DOWNLOAD_STATE: OptionsDownloadState = {
  tasks: [],
  queueStorageBytes: 0,
}
interface DownloadRead {
  hasSnapshot: RefObject<boolean>
  latestRequestId: RefObject<number>
  setState: (state: OptionsDownloadState) => void
  setStatus: (status: StorageReadStatus) => void
}
async function refreshDownloads(read: DownloadRead): Promise<void> {
  const requestId = ++read.latestRequestId.current
  if (!read.hasSnapshot.current) read.setStatus("loading")
  try {
    const response = await sendRuntimeMessage({
      target: "background",
      type: "GET_OPTIONS_DOWNLOAD_STATE",
    })
    if (!response.success) throw new Error(response.error)
    if (requestId !== read.latestRequestId.current) return
    read.setState(response.data)
    read.hasSnapshot.current = true
    read.setStatus("ready")
  } catch (error) {
    if (requestId !== read.latestRequestId.current) return
    logger.error("[DOWNLOADS TAB] Failed to refresh download state:", error)
    read.setStatus(read.hasSnapshot.current ? "stale" : "error")
  }
}

function subscribeToDownloads(
  refresh: () => Promise<void>,
  onError: (error: unknown) => void
): () => void {
  const handleChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: chrome.storage.AreaName
  ) => {
    if (areaName === "local" && LOCAL_STORAGE_KEYS.downloadQueue in changes)
      void refresh()
  }
  let disposed = false
  let subscribed = false
  queueMicrotask(() => {
    if (disposed) return
    try {
      chrome.storage.onChanged.addListener(handleChange)
      subscribed = true
    } catch (error) {
      onError(error)
      return
    }
    void refresh()
  })
  return () => {
    disposed = true
    if (subscribed) chrome.storage.onChanged.removeListener(handleChange)
  }
}

export function useOptionsDownloadRead() {
  const [downloadState, setDownloadState] = useState(EMPTY_DOWNLOAD_STATE)
  const [readStatus, setReadStatus] = useState<StorageReadStatus>("loading")
  const [readAttempt, setReadAttempt] = useState(0)
  const hasSnapshot = useRef(false)
  const latestRequestId = useRef(0)
  const refreshDownloadState = useCallback(
    () =>
      refreshDownloads({
        hasSnapshot,
        latestRequestId,
        setState: setDownloadState,
        setStatus: setReadStatus,
      }),
    []
  )
  useEffect(() => {
    const unsubscribe = subscribeToDownloads(refreshDownloadState, (error) => {
      logger.error(
        "[DOWNLOADS TAB] Failed to subscribe to download state:",
        error
      )
      setReadStatus(hasSnapshot.current ? "stale" : "error")
    })
    return () => {
      latestRequestId.current += 1
      unsubscribe()
    }
  }, [refreshDownloadState, readAttempt])
  return {
    downloadState,
    readStatus,
    refreshDownloadState,
    retryRead: () => setReadAttempt((attempt) => attempt + 1),
  }
}
