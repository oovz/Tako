import logger from '@/src/runtime/logger'
import { settingsService } from '@/src/storage/settings-service'
import { LOCAL_STORAGE_KEYS, SESSION_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import { recordOffscreenActivity } from '@/entrypoints/background/offscreen-lifecycle'
import { isRecord } from '@/src/shared/type-guards'
import type { CentralizedStateManager } from '@/src/runtime/centralized-state'
import type {
  OffscreenDownloadProgressMessage,
  OffscreenDownloadProgressResponse,
} from '@/src/types/offscreen-messages'

interface ActiveChapterSnapshot {
  chapterId: string
  chapterTitle?: string
  imagesProcessed: number
  totalImages: number
  updatedAt: number
}

function normalizeStatus(value: unknown): OffscreenDownloadProgressMessage['payload']['status'] | undefined {
  return value === 'downloading' || value === 'completed' || value === 'failed' || value === 'partial_success'
    ? value
    : undefined
}

function readActiveChapterMap(
  storedProgressValue: unknown,
  taskId: string,
): Map<string, ActiveChapterSnapshot> {
  const activeChapterMap = new Map<string, ActiveChapterSnapshot>()

  if (!isRecord(storedProgressValue)) {
    return activeChapterMap
  }

  const previousTaskId = typeof storedProgressValue.taskId === 'string' ? storedProgressValue.taskId : undefined
  const previousActiveChapters = storedProgressValue.activeChapters

  if (previousTaskId !== taskId || !Array.isArray(previousActiveChapters)) {
    return activeChapterMap
  }

  for (const chapterSnapshot of previousActiveChapters) {
    if (!isRecord(chapterSnapshot)) {
      continue
    }

    const existingChapterId = typeof chapterSnapshot.chapterId === 'string'
      ? chapterSnapshot.chapterId
      : undefined
    if (!existingChapterId) {
      continue
    }

    const existingChapterTitle = typeof chapterSnapshot.chapterTitle === 'string'
      ? chapterSnapshot.chapterTitle.trim()
      : ''

    activeChapterMap.set(existingChapterId, {
      chapterId: existingChapterId,
      chapterTitle: existingChapterTitle.length > 0 ? existingChapterTitle : undefined,
      imagesProcessed:
        typeof chapterSnapshot.imagesProcessed === 'number'
          ? Math.max(0, chapterSnapshot.imagesProcessed)
          : 0,
      totalImages:
        typeof chapterSnapshot.totalImages === 'number'
          ? Math.max(0, chapterSnapshot.totalImages)
          : 0,
      updatedAt:
        typeof chapterSnapshot.updatedAt === 'number'
          ? chapterSnapshot.updatedAt
          : 0,
    })
  }

  return activeChapterMap
}

function normalizeActiveChapters(input: {
  activeChapters: ActiveChapterSnapshot[]
  taskChapters: Array<{ id?: string; url?: string; status: string }>
}): ActiveChapterSnapshot[] {
  const downloadingChapterCanonicalIds = new Set<string>()
  const chapterKeyToCanonicalId = new Map<string, string>()

  for (const chapter of input.taskChapters) {
    if (chapter.status !== 'downloading') {
      continue
    }

    const chapterIdKey = typeof chapter.id === 'string' ? chapter.id.trim() : ''
    const chapterUrlKey = typeof chapter.url === 'string' ? chapter.url.trim() : ''
    const canonicalKey = chapterIdKey.length > 0 ? chapterIdKey : chapterUrlKey
    if (canonicalKey.length === 0) {
      continue
    }

    downloadingChapterCanonicalIds.add(canonicalKey)
    if (chapterIdKey.length > 0) {
      chapterKeyToCanonicalId.set(chapterIdKey, canonicalKey)
    }
    if (chapterUrlKey.length > 0) {
      chapterKeyToCanonicalId.set(chapterUrlKey, canonicalKey)
    }
  }

  const normalizedActiveChapterMap = new Map<string, ActiveChapterSnapshot>()
  for (const chapterSnapshot of input.activeChapters) {
    const canonicalKey = chapterKeyToCanonicalId.get(chapterSnapshot.chapterId) ?? chapterSnapshot.chapterId
    if (downloadingChapterCanonicalIds.size > 0 && !downloadingChapterCanonicalIds.has(canonicalKey)) {
      continue
    }

    const previousSnapshot = normalizedActiveChapterMap.get(canonicalKey)
    if (!previousSnapshot || chapterSnapshot.updatedAt >= previousSnapshot.updatedAt) {
      normalizedActiveChapterMap.set(canonicalKey, {
        ...chapterSnapshot,
        chapterId: canonicalKey,
      })
    }
  }

  return [...normalizedActiveChapterMap.values()].sort((left, right) => left.chapterId.localeCompare(right.chapterId))
}

export async function handleOffscreenDownloadProgress(
  stateManager: CentralizedStateManager,
  message: OffscreenDownloadProgressMessage,
): Promise<OffscreenDownloadProgressResponse> {
  try {
    const { payload } = message
    const taskId = typeof payload.taskId === 'string' ? payload.taskId : undefined
    const chapterId = typeof payload.chapterId === 'string' ? payload.chapterId : undefined
    const imagesProcessed = typeof payload.imagesProcessed === 'number' ? payload.imagesProcessed : undefined
    const totalImages = typeof payload.totalImages === 'number' ? payload.totalImages : undefined
    const imagesFailed = typeof payload.imagesFailed === 'number' ? payload.imagesFailed : undefined
    const fsaFallbackTriggered = payload.fsaFallbackTriggered === true
    const chapterTitle = typeof payload.chapterTitle === 'string' ? payload.chapterTitle : undefined
    const status = normalizeStatus(payload.status)
    const errorMessage = typeof payload.error === 'string' ? payload.error : undefined

    await recordOffscreenActivity()

    if (!taskId || !chapterId || !status) {
      return { success: false, error: 'Missing taskId, chapterId, or status in OFFSCREEN_DOWNLOAD_PROGRESS' }
    }

    if (fsaFallbackTriggered) {
      const currentSettings = await settingsService.getSettings()
      if (
        currentSettings.downloads.downloadMode === 'custom' ||
        currentSettings.downloads.customDirectoryEnabled
      ) {
        await settingsService.updateSettings({
          downloads: {
            ...currentSettings.downloads,
            downloadMode: 'browser',
            customDirectoryEnabled: false,
            customDirectoryHandleId: null,
          },
        })
      }

      await chrome.storage.local.set({
        [LOCAL_STORAGE_KEYS.fsaError]: {
          active: true,
          message:
            'Custom download folder is no longer accessible. Falling back to browser downloads.',
        },
      })

      logger.warn(`FSA fallback triggered for task ${taskId}`)
    }

    const globalStateBeforeUpdate = await stateManager.getGlobalState()
    const taskBeforeUpdate = globalStateBeforeUpdate.downloadQueue.find((task) => task.id === taskId)
    if (!taskBeforeUpdate) {
      logger.debug(`Ignoring OFFSCREEN_DOWNLOAD_PROGRESS for unknown task: ${taskId}`)
      return { success: true }
    }

    const taskChapter = taskBeforeUpdate.chapters.find((chapter) => chapter.id === chapterId)
    if (!taskChapter) {
      logger.debug(`Ignoring OFFSCREEN_DOWNLOAD_PROGRESS for unknown chapter: ${chapterId}`)
      return { success: true }
    }

    const payloadChapterTitle = typeof chapterTitle === 'string' ? chapterTitle.trim() : ''
    const stableTaskChapterTitle = typeof taskChapter.title === 'string' ? taskChapter.title.trim() : ''
    const progressChapterTitle = payloadChapterTitle.length > 0
      ? payloadChapterTitle
      : stableTaskChapterTitle.length > 0
        ? stableTaskChapterTitle
        : undefined
    const normalizedChapterId = chapterId.trim()
    const canonicalChapterId = (() => {
      const stableChapterId = typeof taskChapter.id === 'string' ? taskChapter.id.trim() : ''
      if (stableChapterId.length > 0) {
        return stableChapterId
      }

      const stableChapterUrl = typeof taskChapter.url === 'string' ? taskChapter.url.trim() : ''
      if (stableChapterUrl.length > 0) {
        return stableChapterUrl
      }

      return normalizedChapterId
    })()
    const chapterIdentityAliases = new Set<string>([
      normalizedChapterId,
      ...(typeof taskChapter.id === 'string' && taskChapter.id.trim().length > 0 ? [taskChapter.id.trim()] : []),
      ...(typeof taskChapter.url === 'string' && taskChapter.url.trim().length > 0 ? [taskChapter.url.trim()] : []),
    ])
    const isTerminalChapterStatus = (chapterStatus: string | undefined): boolean =>
      chapterStatus === 'completed' || chapterStatus === 'failed' || chapterStatus === 'partial_success'
    const shouldIgnoreStaleChapterProgress =
      isTerminalChapterStatus(taskChapter.status) && status === 'downloading'

    if (!shouldIgnoreStaleChapterProgress) {
      const chapterErrorMessage = status === 'failed' || status === 'partial_success' ? errorMessage : undefined

      await stateManager.updateDownloadTaskChapter(taskId, canonicalChapterId, status, {
        totalImages: typeof totalImages === 'number' ? totalImages : undefined,
        imagesFailed: typeof imagesFailed === 'number' ? imagesFailed : undefined,
        errorMessage: chapterErrorMessage,
      })
    }

    const activeTaskProgressStorage = await chrome.storage.session.get(SESSION_STORAGE_KEYS.activeTaskProgress) as Record<string, unknown>
    const storedProgressValue = activeTaskProgressStorage[SESSION_STORAGE_KEYS.activeTaskProgress]
    const activeChapterMap = readActiveChapterMap(storedProgressValue, taskId)

    const deleteChapterAliases = (): void => {
      for (const alias of chapterIdentityAliases) {
        activeChapterMap.delete(alias)
      }
    }

    if (shouldIgnoreStaleChapterProgress || status === 'completed' || status === 'failed' || status === 'partial_success') {
      deleteChapterAliases()
    } else {
      let existingChapterSnapshot: ActiveChapterSnapshot | undefined
      for (const alias of chapterIdentityAliases) {
        const snapshot = activeChapterMap.get(alias)
        if (!snapshot) {
          continue
        }

        if (!existingChapterSnapshot || snapshot.updatedAt >= existingChapterSnapshot.updatedAt) {
          existingChapterSnapshot = snapshot
        }
      }

      deleteChapterAliases()
      activeChapterMap.set(canonicalChapterId, {
        chapterId: canonicalChapterId,
        chapterTitle: progressChapterTitle ?? existingChapterSnapshot?.chapterTitle,
        imagesProcessed: Math.max(0, imagesProcessed ?? existingChapterSnapshot?.imagesProcessed ?? 0),
        totalImages: Math.max(0, totalImages ?? existingChapterSnapshot?.totalImages ?? 0),
        updatedAt: Date.now(),
      })
    }

    const activeChapters = [...activeChapterMap.values()].sort((left, right) => left.chapterId.localeCompare(right.chapterId))
    const globalStateAfterUpdate = await stateManager.getGlobalState()
    const taskAfterUpdate = globalStateAfterUpdate.downloadQueue.find((task) => task.id === taskId)
    const normalizedActiveChapters = normalizeActiveChapters({
      activeChapters,
      taskChapters: taskAfterUpdate?.chapters ?? [],
    })

    if (normalizedActiveChapters.length === 0) {
      await chrome.storage.session.set({
        [SESSION_STORAGE_KEYS.activeTaskProgress]: null,
      })
      return { success: true }
    }

    const aggregateImagesProcessed = normalizedActiveChapters.reduce(
      (sum, chapterSnapshot) => sum + chapterSnapshot.imagesProcessed,
      0,
    )
    const aggregateTotalImages = normalizedActiveChapters.reduce(
      (sum, chapterSnapshot) => sum + chapterSnapshot.totalImages,
      0,
    )
    const singleActiveChapter = normalizedActiveChapters.length === 1 ? normalizedActiveChapters[0] : undefined

    await chrome.storage.session.set({
      [SESSION_STORAGE_KEYS.activeTaskProgress]: {
        taskId,
        chapterId: singleActiveChapter?.chapterId,
        chapterTitle: singleActiveChapter?.chapterTitle,
        activeChapterCount: normalizedActiveChapters.length,
        activeChapters: normalizedActiveChapters,
        imagesProcessed: aggregateImagesProcessed,
        totalImages: aggregateTotalImages,
        status: 'downloading',
      },
    })

    return { success: true }
  } catch (e: unknown) {
    logger.error('Error handling OFFSCREEN_DOWNLOAD_PROGRESS', e)
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return { success: false, error: msg }
  }
}

