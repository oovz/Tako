import { useEffect, useState } from "react"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"

export function useTaskDetails(taskId: string, enabled: boolean) {
  const [result, setResult] = useState<{
    id: string
    task: DownloadTaskState | null
    error: boolean
  } | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let revision = 0
    const refresh = async () => {
      const request = ++revision
      try {
        const response = await sendRuntimeMessage({
          target: "background",
          type: "GET_SIDEPANEL_TASK",
          payload: { taskId },
        })
        if (!response.success) throw new Error(response.error)
        if (!disposed && revision === request)
          setResult({ id: taskId, task: response.task, error: false })
      } catch {
        if (!disposed && revision === request)
          setResult({ id: taskId, task: null, error: true })
      }
    }
    const changed = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      if (area === "local" && LOCAL_STORAGE_KEYS.downloadQueue in changes)
        void refresh()
    }
    chrome.storage.onChanged.addListener(changed)
    void refresh()
    return () => {
      disposed = true
      chrome.storage.onChanged.removeListener(changed)
    }
  }, [taskId, enabled, attempt])
  return {
    task: result?.id === taskId ? result.task : null,
    error: result?.id === taskId && result.error,
    retry: () => setAttempt((value) => value + 1),
  }
}
