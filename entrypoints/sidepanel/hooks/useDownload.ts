import { useState, useCallback, useEffect, useRef } from 'react'
// no local item mutations; rely on centralized state
import type { MangaPageState, ChapterState } from '@/src/types/tab-state'
import type { StartDownloadMessage, StartDownloadResponse } from '@/src/types/runtime-command-messages'
import logger from '@/src/runtime/logger'

const SUCCESS_HIDE_DELAY_MS = 2000

export function buildStartDownloadMessage(input: {
  tabId: number
  mangaState: MangaPageState
  selectedChapterStates: ChapterState[]
}): StartDownloadMessage {
  const { tabId, mangaState, selectedChapterStates } = input

  return {
    type: 'START_DOWNLOAD',
    payload: {
      sourceTabId: tabId,
      siteIntegrationId: mangaState.siteIntegrationId,
      mangaId: mangaState.mangaId,
      seriesTitle: mangaState.seriesTitle,
      chapters: selectedChapterStates.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        url: chapter.url,
        index: chapter.index,
        chapterLabel: chapter.chapterLabel,
        chapterNumber: chapter.chapterNumber,
        volumeLabel: chapter.volumeLabel,
        volumeNumber: chapter.volumeNumber,
        language: chapter.language,
      })),
      metadata: mangaState.metadata ? { ...mangaState.metadata } : undefined,
    },
  }
}

export function resolveSelectedChapterStates(
  chapters: ChapterState[],
  selectedChapterIds: string[],
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
export function resolveDownloadSeriesIdentity(mangaState: MangaPageState | undefined): {
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
  tabId: number | undefined
  mangaState?: MangaPageState
}

interface UseDownloadReturn {
  startDownload: (selectedChapterIds: string[]) => Promise<boolean>
  showSuccess: boolean
  /** True while a download enqueue request is in-flight (prevents double-clicks) */
  isEnqueuing: boolean
}

export function useDownload({ tabId, mangaState }: UseDownloadOptions): UseDownloadReturn {
  const [showSuccess, setShowSuccess] = useState(false)
  const [isEnqueuing, setIsEnqueuing] = useState(false)
  const successHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (successHideTimeoutRef.current !== null) {
        clearTimeout(successHideTimeoutRef.current)
      }
    }
  }, [])

  const startDownload = useCallback(async (selectedChapterIds: string[]) => {
    if (typeof tabId !== 'number' || !mangaState || isEnqueuing) return false
    try {
      setIsEnqueuing(true)
      setShowSuccess(false)
      if (successHideTimeoutRef.current !== null) {
        clearTimeout(successHideTimeoutRef.current)
        successHideTimeoutRef.current = null
      }
      const selectedChapterStates = resolveSelectedChapterStates(
        mangaState.chapters,
        selectedChapterIds,
      )
      if (selectedChapterStates.length === 0) {
        return false
      }
      if (selectedChapterStates.some((chapter) => typeof chapter.id !== 'string' || chapter.id.trim().length === 0)) {
        throw new Error('Selected chapters must include stable ids')
      }
      const startDownloadMessage = buildStartDownloadMessage({
        tabId,
        mangaState,
        selectedChapterStates,
      })

      const enqueueResponse = await chrome.runtime.sendMessage<StartDownloadMessage, StartDownloadResponse>(startDownloadMessage)
      if (enqueueResponse?.success !== true) {
        const enqueueError = enqueueResponse && enqueueResponse.success === false
          ? enqueueResponse.error
          : undefined
        throw new Error(enqueueError || 'Failed to enqueue download task')
      }

      setShowSuccess(true)
      successHideTimeoutRef.current = setTimeout(() => {
        setShowSuccess(false)
        successHideTimeoutRef.current = null
      }, SUCCESS_HIDE_DELAY_MS)
      return true
    } catch (error) {
      logger.error('❌ Failed to start download:', error)
      return false
    } finally {
      setIsEnqueuing(false)
    }
  }, [tabId, mangaState, isEnqueuing])
  
  return {
    startDownload,
    showSuccess,
    isEnqueuing
  }
}

