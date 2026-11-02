import { useEffect, useState } from "react"
import type { DownloadedChapterRecord } from "@/src/domain/history/types"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import logger from "@/src/runtime/logger"

const HISTORY_KEYS = [
  LOCAL_STORAGE_KEYS.downloadedChapters,
  LOCAL_STORAGE_KEYS.seriesDownloadHistory,
  LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs,
]

function historyChanged(
  changes: Record<string, chrome.storage.StorageChange>,
  area: chrome.storage.AreaName
) {
  return area === "local" && HISTORY_KEYS.some((key) => key in changes)
}

export function useSidepanelDownloadedChapters(): DownloadedChapterRecord[] {
  const [downloadedChapters, setDownloadedChapters] = useState<
    DownloadedChapterRecord[]
  >([])
  useEffect(() => {
    let latestRequestId = 0
    let disposed = false
    async function refresh() {
      if (disposed) return
      const requestId = ++latestRequestId
      try {
        const response = await sendRuntimeMessage({
          target: "background",
          type: "GET_SIDEPANEL_DOWNLOAD_STATE",
        })
        if (!response.success) throw new Error(response.error)
        if (requestId === latestRequestId)
          setDownloadedChapters(response.data.downloadedChapters)
      } catch (error) {
        if (requestId === latestRequestId)
          logger.debug("[sidepanel] Downloaded chapter query failed", error)
      }
    }
    const handleChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName
    ) => {
      if (historyChanged(changes, area)) void refresh()
    }
    queueMicrotask(() => {
      void refresh()
    })
    chrome.storage.onChanged.addListener(handleChange)
    return () => {
      disposed = true
      latestRequestId++
      chrome.storage.onChanged.removeListener(handleChange)
    }
  }, [])
  return downloadedChapters
}
