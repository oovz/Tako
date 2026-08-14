import { useState, useCallback, useEffect, useRef } from "react"
// no local item mutations; rely on centralized state
import type { MangaPageState, ChapterState } from "@/src/types/tab-state"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
import { sendRuntimeMessageWithRetry } from "@/src/runtime/send-runtime-message"
import logger from "@/src/runtime/logger"
import { createPendingActionGuard } from "@/entrypoints/sidepanel/hooks/pending-action-guard"
import { createCommandEnvelope } from "@/src/runtime/command-envelope"
import { t } from "@/src/runtime/i18n"
import type { StartDownloadFailureCode } from "@/src/runtime/start-download-errors"

const SUCCESS_HIDE_DELAY_MS = 2000

const START_DOWNLOAD_ERROR_KEYS: Record<
  StartDownloadFailureCode | "unknown",
  string
> = {
  stale_series_context: "startDownloadError_staleSeriesContext",
  invalid_chapter_selection: "startDownloadError_invalidChapterSelection",
  integration_disabled: "startDownloadError_integrationDisabled",
  host_permission_required: "startDownloadError_hostPermissionRequired",
  durable_state_failure: "startDownloadError_durableStateFailure",
  unknown: "sidepanel_enqueueFailed",
}

function getStartDownloadErrorMessage(
  code: StartDownloadFailureCode | undefined
): string {
  return t(START_DOWNLOAD_ERROR_KEYS[code ?? "unknown"])
}

export function buildStartDownloadMessage(input: {
  windowId: number
  tabId: number
  sourceUrl: string
  siteIntegrationId: string
  seriesId: string
  seriesRevision: number
  selectedChapterIds: string[]
}): RuntimeMessageRequest<"START_DOWNLOAD"> {
  const {
    windowId,
    tabId,
    sourceUrl,
    siteIntegrationId,
    seriesId,
    seriesRevision,
    selectedChapterIds,
  } = input

  return {
    target: "background",
    type: "START_DOWNLOAD",
    ...createCommandEnvelope(),
    payload: {
      sourceWindowId: windowId,
      sourceTabId: tabId,
      sourceUrl,
      siteIntegrationId,
      seriesId,
      seriesRevision,
      selectedChapterIds: [...selectedChapterIds],
    },
  }
}

export async function createStartDownloadRetentionKey(
  payload: RuntimeMessageRequest<"START_DOWNLOAD">["payload"]
): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(payload))
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded)
  const fingerprint = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
  return `START_DOWNLOAD:${payload.sourceWindowId}:${payload.sourceTabId}:${fingerprint}`
}

export function resolveSelectedChapterStates(
  chapters: ChapterState[],
  selectedChapterIds: string[]
): ChapterState[] {
  if (!Array.isArray(chapters) || chapters.length === 0) {
    return []
  }

  if (!Array.isArray(selectedChapterIds) || selectedChapterIds.length === 0) {
    return []
  }

  const selectedChapterIdSet = new Set(selectedChapterIds)
  return chapters.filter((chapter) => selectedChapterIdSet.has(chapter.id))
}
export function resolveDownloadSeriesIdentity(
  mangaState: MangaPageState | undefined
): {
  seriesId: string | undefined
  siteId: string | undefined
} {
  if (!mangaState) {
    return {
      seriesId: undefined,
      siteId: undefined,
    }
  }

  return {
    seriesId: mangaState.mangaId,
    siteId: mangaState.siteIntegrationId,
  }
}

interface UseDownloadOptions {
  windowId: number | undefined
  tabId: number | undefined
  mangaState?: MangaPageState
  seriesRevision: number | undefined
}

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
  const [showSuccess, setShowSuccess] = useState(false)
  const [isEnqueuing, setIsEnqueuing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const pendingGuardRef = useRef(createPendingActionGuard())
  const successHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (successHideTimeoutRef.current !== null) {
        clearTimeout(successHideTimeoutRef.current)
      }
    }
  }, [])

  const startDownload = useCallback(
    async (selectedChapterIds: string[]) => {
      if (
        typeof tabId !== "number" ||
        typeof windowId !== "number" ||
        !mangaState ||
        typeof mangaState.sourceUrl !== "string" ||
        typeof seriesRevision !== "number"
      ) {
        return false
      }

      const pendingKey = "enqueue"
      if (!pendingGuardRef.current.tryBegin(pendingKey)) return false

      try {
        setIsEnqueuing(true)
        setShowSuccess(false)
        setErrorMessage(null)
        if (successHideTimeoutRef.current !== null) {
          clearTimeout(successHideTimeoutRef.current)
          successHideTimeoutRef.current = null
        }
        const selectedChapterStates = resolveSelectedChapterStates(
          mangaState.chapters,
          selectedChapterIds
        )
        if (selectedChapterStates.length === 0) {
          setErrorMessage(t("sidepanel_selectedChaptersUnavailable"))
          return false
        }
        if (
          selectedChapterStates.some(
            (chapter) =>
              typeof chapter.id !== "string" || chapter.id.trim().length === 0
          )
        ) {
          throw new Error("Selected chapters must include stable ids")
        }
        const startDownloadMessage = buildStartDownloadMessage({
          windowId,
          tabId,
          sourceUrl: mangaState.sourceUrl,
          siteIntegrationId: mangaState.siteIntegrationId,
          seriesId: mangaState.mangaId,
          seriesRevision,
          selectedChapterIds: selectedChapterStates.map(
            (chapter) => chapter.id
          ),
        })

        const enqueueResponse = await sendRuntimeMessageWithRetry(
          startDownloadMessage,
          {
            retentionKey: await createStartDownloadRetentionKey(
              startDownloadMessage.payload
            ),
          }
        )
        if (enqueueResponse?.success !== true) {
          const code =
            enqueueResponse && "code" in enqueueResponse
              ? enqueueResponse.code
              : undefined
          setErrorMessage(getStartDownloadErrorMessage(code))
          return false
        }

        // Guard against setting state after unmount
        if (!isMountedRef.current) return true

        setShowSuccess(true)
        successHideTimeoutRef.current = setTimeout(() => {
          if (!isMountedRef.current) {
            successHideTimeoutRef.current = null
            return
          }
          setShowSuccess(false)
          successHideTimeoutRef.current = null
        }, SUCCESS_HIDE_DELAY_MS)
        return true
      } catch (error) {
        logger.error("❌ Failed to start download:", error)
        if (isMountedRef.current) {
          setErrorMessage(t("sidepanel_enqueueFailed"))
        }
        return false
      } finally {
        pendingGuardRef.current.finish(pendingKey)
        if (isMountedRef.current) {
          setIsEnqueuing(false)
        }
      }
    },
    [mangaState, seriesRevision, tabId, windowId]
  )

  return {
    startDownload,
    showSuccess,
    isEnqueuing,
    errorMessage,
  }
}
