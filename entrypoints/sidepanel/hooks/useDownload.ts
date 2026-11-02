import { useCallback, useRef } from "react"
import logger from "@/src/runtime/logger"
import { t } from "@/src/runtime/i18n"
import { createPendingActionGuard } from "./pending-action-guard"
import { useDownloadFeedback } from "./useDownload-feedback"
import {
  enqueueDownload,
  resolveDownloadContext,
  type UseDownloadOptions,
} from "./useDownload-request"

export {
  buildStartDownloadMessage,
  createStartDownloadRetentionKey,
  resolveSelectedChapterStates,
  resolveDownloadSeriesIdentity,
} from "./useDownload-request"

interface UseDownloadReturn {
  startDownload: (selectedChapterIds: string[]) => Promise<boolean>
  showSuccess: boolean
  /** True while a download enqueue request is in-flight (prevents double-clicks) */
  isEnqueuing: boolean
  errorMessage: string | null
}

export function useDownload({
  windowId,
  tabId,
  mangaState,
  seriesRevision,
}: UseDownloadOptions): UseDownloadReturn {
  const feedback = useDownloadFeedback()
  const { begin, succeed, fail, finish } = feedback
  const pendingGuardRef = useRef(createPendingActionGuard())
  const startDownload = useCallback(
    async (selectedChapterIds: string[]) => {
      const context = resolveDownloadContext({
        windowId,
        tabId,
        mangaState,
        seriesRevision,
      })
      if (!context) return false
      const pendingKey = "enqueue"
      if (!pendingGuardRef.current.tryBegin(pendingKey)) return false
      try {
        begin()
        const result = await enqueueDownload(context, selectedChapterIds)
        if (!result.success) {
          fail(result.errorMessage)
          return false
        }
        succeed()
        return true
      } catch (error) {
        logger.error("❌ Failed to start download:", error)
        fail(t("sidepanel_enqueueFailed"))
        return false
      } finally {
        pendingGuardRef.current.finish(pendingKey)
        finish()
      }
    },
    [begin, fail, finish, mangaState, seriesRevision, succeed, tabId, windowId]
  )

  return {
    startDownload,
    showSuccess: feedback.showSuccess,
    isEnqueuing: feedback.isEnqueuing,
    errorMessage: feedback.errorMessage,
  }
}
