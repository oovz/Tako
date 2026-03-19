import logger from '@/src/runtime/logger'
import { createTaskSettingsSnapshot } from '@/entrypoints/background/settings-snapshot'
import { siteIntegrationSettingsService } from '@/src/storage/site-integration-settings-service'
import { siteOverridesService } from '@/src/storage/site-overrides-service'
import { sanitizeLabel } from '@/src/shared/site-integration-utils'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'
import type { DownloadTaskState } from '@/src/types/queue-state'
import type { SeriesMetadataSnapshot } from '@/src/types/state-snapshots'

export interface StartDownloadPayload {
  siteIntegrationId: string
  mangaId: string
  seriesTitle: string
  chapters: Array<{
    id: string
    title: string
    url: string
    index: number
    chapterLabel?: string
    chapterNumber?: number
    volumeLabel?: string
    volumeNumber?: number
    language?: string
  }>
  metadata?: SeriesMetadataSnapshot
}

export async function enqueueStartDownloadTask(
  stateManager: CentralizedStateManager,
  payload: StartDownloadPayload,
  tabId: number,
): Promise<{ success: boolean; taskId?: string; reason?: string }> {
  if (!payload.siteIntegrationId || !payload.mangaId || !payload.seriesTitle) {
    return { success: false, reason: 'Invalid START_DOWNLOAD payload' }
  }

  if (!Array.isArray(payload.chapters) || payload.chapters.length === 0) {
    return { success: false, reason: 'No chapters selected for download' }
  }

  if (payload.chapters.some((chapter) => typeof chapter.id !== 'string' || chapter.id.trim().length === 0)) {
    return { success: false, reason: 'Invalid START_DOWNLOAD payload' }
  }

  const now = Date.now()
  const globalState = await stateManager.getGlobalState()
  const siteOverrides = await siteOverridesService.getAll()
  const siteOverride = siteOverrides[payload.siteIntegrationId]
  const siteSettings = await siteIntegrationSettingsService.getForSite(payload.siteIntegrationId) as Record<string, unknown>
  const settingsSnapshot = createTaskSettingsSnapshot(globalState.settings, payload.siteIntegrationId, {
    siteSettings,
    siteOverride,
    comicInfo: payload.metadata,
  })

  const chapters: DownloadTaskState['chapters'] = payload.chapters.map((chapter) => {
    const normalizedTitle = sanitizeLabel(chapter.title || 'Untitled chapter')
    const normalizedChapterLabel = chapter.chapterLabel ? sanitizeLabel(chapter.chapterLabel) : undefined
    const normalizedVolumeLabel = chapter.volumeLabel ? sanitizeLabel(chapter.volumeLabel) : undefined

    return {
      id: chapter.id,
      url: chapter.url,
      title: normalizedTitle,
      index: chapter.index,
      language: chapter.language,
      chapterLabel: normalizedChapterLabel,
      chapterNumber: typeof chapter.chapterNumber === 'number' ? chapter.chapterNumber : undefined,
      volumeNumber: typeof chapter.volumeNumber === 'number' ? chapter.volumeNumber : undefined,
      volumeLabel: normalizedVolumeLabel,
      status: 'queued',
      lastUpdated: now,
    }
  })

  const taskId = crypto.randomUUID()
  const task: DownloadTaskState = {
    id: taskId,
    siteIntegrationId: payload.siteIntegrationId,
    mangaId: payload.mangaId,
    seriesTitle: sanitizeLabel(payload.seriesTitle),
    seriesCoverUrl: typeof payload.metadata?.coverUrl === 'string' ? payload.metadata.coverUrl : undefined,
    chapters,
    status: 'queued',
    created: now,
    isRetried: false,
    isRetryTask: false,
    lastSuccessfulDownloadId: undefined,
    settingsSnapshot,
  }

  await stateManager.addDownloadTask(task)
  logger.info('[Queue]', {
    event: 'START_DOWNLOAD_ENQUEUED',
    taskId,
    sourceTabId: tabId,
    chapters: chapters.length,
    siteIntegrationId: payload.siteIntegrationId,
    mangaId: payload.mangaId,
  })

  return { success: true, taskId }
}

