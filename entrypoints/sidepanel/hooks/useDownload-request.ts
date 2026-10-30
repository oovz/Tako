import type { MangaPageState, ChapterState } from "@/src/types/tab-state"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
import { sendRuntimeMessageWithRetry } from "@/src/runtime/send-runtime-message"
import { createCommandEnvelope } from "@/src/runtime/command-envelope"
import { t } from "@/src/runtime/i18n"
import type { StartDownloadFailureCode } from "@/src/runtime/start-download-errors"

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

export interface UseDownloadOptions {
  windowId: number | undefined
  tabId: number | undefined
  mangaState?: MangaPageState
  seriesRevision: number | undefined
}

interface DownloadContext {
  windowId: number
  tabId: number
  mangaState: MangaPageState
  seriesRevision: number
}

export function resolveDownloadContext(
  input: UseDownloadOptions
): DownloadContext | undefined {
  const { tabId, windowId, mangaState, seriesRevision } = input
  if (
    typeof tabId !== "number" ||
    typeof windowId !== "number" ||
    !mangaState ||
    typeof mangaState.sourceUrl !== "string" ||
    typeof seriesRevision !== "number"
  )
    return
  return {
    tabId,
    windowId,
    mangaState,
    seriesRevision,
  }
}

function prepareDownloadMessage(
  context: DownloadContext,
  selectedChapterIds: string[]
): RuntimeMessageRequest<"START_DOWNLOAD"> | undefined {
  const { mangaState, windowId, tabId, seriesRevision } = context
  const chapters = resolveSelectedChapterStates(
    mangaState.chapters,
    selectedChapterIds
  )
  if (chapters.length === 0) return
  if (
    chapters.some(
      (chapter) =>
        typeof chapter.id !== "string" || chapter.id.trim().length === 0
    )
  ) {
    throw new Error("Selected chapters must include stable ids")
  }
  return buildStartDownloadMessage({
    windowId,
    tabId,
    seriesRevision,
    sourceUrl: mangaState.sourceUrl,
    siteIntegrationId: mangaState.siteIntegrationId,
    seriesId: mangaState.mangaId,
    selectedChapterIds: chapters.map((chapter) => chapter.id),
  })
}

export async function enqueueDownload(
  context: DownloadContext,
  selectedChapterIds: string[]
): Promise<{ success: true } | { success: false; errorMessage: string }> {
  const message = prepareDownloadMessage(context, selectedChapterIds)
  if (!message)
    return {
      success: false,
      errorMessage: t("sidepanel_selectedChaptersUnavailable"),
    }
  const response = await sendRuntimeMessageWithRetry(message, {
    retentionKey: await createStartDownloadRetentionKey(message.payload),
  })
  if (!response.success) {
    return {
      success: false,
      errorMessage: getStartDownloadErrorMessage(response.code),
    }
  }
  return { success: true }
}
