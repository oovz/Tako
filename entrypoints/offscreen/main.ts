/**
 * Offscreen document runtime for archive creation, image processing,
 * and background-assisted downloads.
 */

import type { Chapter } from '@/src/types/chapter'
import {
  withRetries,
  fetchChapterHtml
} from './image-processor'
import { siteIntegrationRegistry } from '@/src/runtime/site-integration-registry'
import logger from '@/src/runtime/logger'
import {
  type ArchiveNormalizationSettings,
  type ChapterDownloadImageFn,
  type ChapterOutcome,
  type ChapterProcessingRuntime,
  type ProcessChapterStreamingOptions,
  processArchiveFormatChapter,
  processNoneFormatChapter,
} from './chapter-processing'
import type {
  OffscreenDownloadChapterMessage,
  OffscreenDownloadProgressMessage,
} from '@/src/types/offscreen-messages'
import { sendStateAction } from '@/src/runtime/state-actions'
import { StateAction } from '@/src/types/state-actions'
import { resolveEffectiveRetries } from '@/src/shared/settings-utils'
import {
  prefetchOptionalCoverImage,
  requestBrowserBlobDownload,
  resolveWritableDownloadRoot,
} from './download-runtime-helpers'
import {
  createDownloadingProgressPayload,
  createStreamingProgressHandlers,
  sendInitialDownloadHeartbeat,
} from './progress-helpers'
import {
  createChapterForProcessing,
  createProcessChapterStreamingOptions,
  readProcessDownloadChapterSettingsSnapshot,
} from './download-request-mappers'
import { classifyOffscreenErrorCategory } from './error-categories'
import { registerOffscreenRuntime } from './runtime-bridge'
import { createOffscreenStatusController } from './status-ui'

// Chrome extension offscreen document: Only chrome.runtime API is available
// All storage operations must be requested from the service worker via messaging

// Performance memory API types (Chrome-specific)
interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface ExtendedPerformance extends Performance {
  memory?: PerformanceMemory;
}

type TaskControllerEntry = {
  controller: AbortController
  activeCount: number
  createdAt: number
}

type PendingChapterProgressEntry = {
  payload: OffscreenDownloadProgressMessage['payload']
  timerId: ReturnType<typeof setTimeout>
}

/**
 * Offscreen Worker Manager
 */
export class OffscreenWorker {
  // Reasonable defaults; site integrations may override via network.timeout
  private static readonly DEFAULT_FETCH_TIMEOUT_MS = 30_000;
  private static readonly DEFAULT_IMAGE_TIMEOUT_MS = 30_000;
  private static readonly DEFAULT_CHAPTER_TIMEOUT_MS = 5 * 60_000; // 5 minutes

  private currentIntegrationId: string | undefined
  private currentRetries: { image: number; chapter: number } | undefined
  private currentHandlesOwnRetries = false
  private readonly chapterProgressLastSentAt = new Map<string, number>()
  private readonly pendingChapterProgress = new Map<string, PendingChapterProgressEntry>()
  private readonly activeTaskControllers = new Map<string, TaskControllerEntry>()

  async initialize(): Promise<void> {
    try {
      logger.debug('🔧 Initializing offscreen worker...')

      // Initialize site integration registry first (required for findSiteIntegrationForUrl)
      logger.debug('🔌 Initializing site integration registry in offscreen...')
      const { initializeSiteIntegrations } = await import('@/src/runtime/site-integration-initialization')
      await initializeSiteIntegrations()

      logger.debug('✅ Offscreen worker initialized - ready for centralized processing')

    } catch (error) {
      logger.error('❌ Failed to initialize offscreen worker:', error)
      throw error
    }
  }

  /**
   * Get current memory usage statistics
   * Expose memory stats for debugging
   */
  getMemoryStats(): { usedMB: number; totalMB: number; limitMB: number } | null {
    const perf = performance as ExtendedPerformance;
    if ('memory' in performance && perf.memory) {
      const memory = perf.memory;
      return {
        usedMB: memory.usedJSHeapSize / (1024 * 1024),
        totalMB: memory.totalJSHeapSize / (1024 * 1024),
        limitMB: memory.jsHeapSizeLimit / (1024 * 1024)
      };
    }
    return null;
  }

  private withImageRetries<T>(fn: () => Promise<T>): Promise<T> {
    if (this.currentHandlesOwnRetries) {
      return fn()
    }
    const imageRetries = this.currentRetries?.image ?? 1
    return withRetries(fn, imageRetries)
  }

  private async sendInitialDownloadHeartbeat(request: OffscreenDownloadChapterMessage['payload']): Promise<void> {
    try {
      await sendInitialDownloadHeartbeat({
        request,
        sendMessageWithRetry: this.sendMessageWithRetry.bind(this),
      })
    } catch (error) {
      logger.debug('Failed to send initial offscreen startup heartbeat (non-fatal):', error)
    }
  }

  private async emitFsaFallbackProgress(taskId: string, chapter: Chapter, totalImages: number): Promise<void> {
    await this.sendChapterProgressMessage(createDownloadingProgressPayload({
      taskId,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      imagesProcessed: 0,
      totalImages,
      fsaFallbackTriggered: true,
    }))
  }

  private async resolveWritableDownloadRoot(input: {
    taskId: string
    chapter: Chapter
    totalImages: number
  }): Promise<FileSystemDirectoryHandle | null> {
    const { taskId, chapter, totalImages } = input
    return await resolveWritableDownloadRoot({
      onFallback: async () => this.emitFsaFallbackProgress(taskId, chapter, totalImages),
    })
  }

  private requestBrowserBlobDownload(input: {
    taskId: string
    chapterId: string
    blob: Blob
    filename: string
  }): ReturnType<typeof requestBrowserBlobDownload> {
    return requestBrowserBlobDownload(input)
  }

  private acquireTaskController(taskId: string): TaskControllerEntry {
    let taskControllerEntry = this.activeTaskControllers.get(taskId)
    if (!taskControllerEntry || taskControllerEntry.controller.signal.aborted) {
      taskControllerEntry = {
        controller: new AbortController(),
        activeCount: 0,
        createdAt: Date.now(),
      }
      this.activeTaskControllers.set(taskId, taskControllerEntry)
    }

    taskControllerEntry.activeCount += 1
    return taskControllerEntry
  }

  private async initializeCurrentIntegrationState(siteIntegrationId: string): Promise<void> {
    this.currentIntegrationId = siteIntegrationId
    this.currentRetries = await resolveEffectiveRetries(this.currentIntegrationId)
    const integrationMeta = siteIntegrationRegistry.findById(this.currentIntegrationId)
    this.currentHandlesOwnRetries = integrationMeta?.handlesOwnRetries === true
  }

  private releaseTaskController(taskId: string, controller: AbortController): void {
    const currentTaskControllerEntry = this.activeTaskControllers.get(taskId)
    if (!currentTaskControllerEntry || currentTaskControllerEntry.controller !== controller) {
      return
    }

    currentTaskControllerEntry.activeCount -= 1
    if (currentTaskControllerEntry.activeCount <= 0) {
      this.activeTaskControllers.delete(taskId)
    }
  }

  public async processDownloadChapter(
    request: OffscreenDownloadChapterMessage['payload']
  ): Promise<ChapterOutcome> {
    const taskControllerEntry = this.acquireTaskController(request.taskId)

    const snapshot = readProcessDownloadChapterSettingsSnapshot(request.settingsSnapshot)
    const chapterForProcessing = createChapterForProcessing(request.chapter)

    await this.initializeCurrentIntegrationState(request.book.siteIntegrationId)

    await this.sendInitialDownloadHeartbeat(request)

    const coverImage = await prefetchOptionalCoverImage({
      includeCoverImage: snapshot.includeCoverImage,
      coverUrl: request.book.coverUrl,
      integrationId: this.currentIntegrationId,
      integrationContext: request.integrationContext,
      withImageRetries: <T>(fn: () => Promise<T>) => this.withImageRetries(fn),
    })

    const latestImageProgress = { current: 0, total: 0 }
    const progressHandlers = createStreamingProgressHandlers({
      taskId: request.taskId,
      chapterId: request.chapter.id,
      chapterTitle: request.chapter.title,
      latestImageProgress,
      emitProgressMessage: (payload) => this.sendChapterProgressMessage(payload),
    })
    const streamingOptions = createProcessChapterStreamingOptions({
      request,
      snapshot,
      chapter: chapterForProcessing,
      abortSignal: taskControllerEntry.controller.signal,
      onProgress: progressHandlers.onProgress,
      onArchiveProgress: progressHandlers.onArchiveProgress,
      coverImage,
    })

    try {
      return await this.processChapterStreaming(streamingOptions);
    } finally {
      this.releaseTaskController(request.taskId, taskControllerEntry.controller)
    }
  }

  // Resolve chapter assets, then dispatch to the specific archive or non-archive flow.
  private async processChapterStreaming(opts: ProcessChapterStreamingOptions): Promise<ChapterOutcome> {
    const { chapter, abortSignal, onProgress } = opts
    const normalizeSettings: ArchiveNormalizationSettings = {
      normalizeImageFilenames: opts.normalizeImageFilenames ?? true,
      imagePaddingDigits: opts.imagePaddingDigits ?? 'auto',
    }

    try {
      const integrationId = this.currentIntegrationId
      if (!integrationId) {
        throw new Error('No integration ID available - processDownloadChapter must be called first')
      }

      const integrationInfo = siteIntegrationRegistry.findById(integrationId)
      if (!integrationInfo || !integrationInfo.integration) {
        throw new Error(`No site integration found for ID: ${integrationId}`)
      }

      const backgroundIntegration = integrationInfo.integration.background
      const downloadImage: ChapterDownloadImageFn = (url, options) => backgroundIntegration.chapter.downloadImage(url, options)

      await onProgress(5, 'fetching')
      if (abortSignal?.aborted) throw new Error('job-cancelled')

      const chapterRetries = this.currentRetries?.chapter ?? 1
      await onProgress(10, 'parsing')
      const urls = backgroundIntegration.chapter.resolveImageUrls
        ? await backgroundIntegration.chapter.resolveImageUrls(
          { id: chapter.id, url: chapter.url },
          opts.integrationContext,
          opts.settingsSnapshot ? { ...opts.settingsSnapshot } : undefined,
        )
        : await (async () => {
          const parseImageUrlsFromHtml = backgroundIntegration.chapter.parseImageUrlsFromHtml
          if (!parseImageUrlsFromHtml) {
            throw new Error(`Site integration ${integrationId} does not implement resolveImageUrls or parseImageUrlsFromHtml`)
          }

          let html = ''
          let htmlFetchErrorMessage: string | undefined
          try {
            html = await withRetries(
              () => fetchChapterHtml(chapter.url, OffscreenWorker.DEFAULT_FETCH_TIMEOUT_MS, integrationId),
              chapterRetries,
            )
          } catch (error) {
            htmlFetchErrorMessage = error instanceof Error ? error.message : (typeof error === 'string' ? error : undefined)
            html = ''
          }

          const raw = await parseImageUrlsFromHtml({
            chapterId: chapter.id,
            chapterUrl: chapter.url,
            chapterHtml: html,
          })
          if (raw.length === 0 && htmlFetchErrorMessage) {
            throw new Error(`Failed to fetch chapter HTML: ${htmlFetchErrorMessage}`)
          }

          return backgroundIntegration.chapter.processImageUrls(raw, chapter)
        })()

      if (urls.length === 0) {
        throw new Error('No images found')
      }

      await onProgress(10, 'ready', { current: 0, total: urls.length })

      const chapterProcessingRuntime: ChapterProcessingRuntime = {
        withImageRetries: <T>(fn: () => Promise<T>) => this.withImageRetries(fn),
        resolveWritableDownloadRoot: (input) => this.resolveWritableDownloadRoot(input),
        emitFsaFallbackProgress: (taskId, targetChapter, totalImages) => this.emitFsaFallbackProgress(taskId, targetChapter, totalImages),
        requestBrowserBlobDownload: (input) => this.requestBrowserBlobDownload(input),
        retryWithBrowserDownloads: async (retryOpts) => this.processChapterStreaming(retryOpts),
        getMemoryStats: () => this.getMemoryStats(),
      }

      if (opts.format === 'none') {
        return processNoneFormatChapter(chapterProcessingRuntime, {
          opts: { ...opts, format: 'none' },
          urls,
          integrationId,
          downloadImage,
          normalizeSettings,
        })
      }

      return processArchiveFormatChapter(chapterProcessingRuntime, {
        opts: { ...opts, format: opts.format },
        urls,
        integrationId,
        downloadImage,
        normalizeSettings,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : (typeof error === 'string' ? error : 'Unknown error')
      if (typeof message === 'string' && message.toLowerCase().includes('job-cancelled')) {
        logger.debug('processChapterStreaming cancelled')
      } else {
        logger.error('processChapterStreaming failed:', error)
      }
      return { status: 'failed', errorMessage: message, errorCategory: classifyOffscreenErrorCategory(error) }
    }
  }

  private async updateDownloadTaskViaAction(taskId: string, updates: Partial<import('@/src/types/queue-state').DownloadTaskState>): Promise<void> {
    try {
      await sendStateAction(StateAction.UPDATE_DOWNLOAD_TASK, {
        taskId,
        updates,
      });
    } catch (error) {
      logger.error('❌ Failed to send download task state action:', error);
    }
  }

  private async sendChapterProgressMessage(payload: OffscreenDownloadProgressMessage['payload']): Promise<void> {
    try {
      const chapterKey = `${payload.taskId}:${payload.chapterId}`
      if (payload.status !== 'downloading') {
        this.clearPendingChapterProgress(chapterKey)
        await this.dispatchChapterProgressMessage(chapterKey, payload)
        return
      }

      const previousSentAt = this.chapterProgressLastSentAt.get(chapterKey) ?? 0
      const elapsedMs = Date.now() - previousSentAt
      const throttleWindowMs = 250
      if (previousSentAt > 0 && elapsedMs < throttleWindowMs) {
        this.schedulePendingChapterProgress(chapterKey, payload, throttleWindowMs - elapsedMs)
        return
      }

      this.clearPendingChapterProgress(chapterKey)
      await this.dispatchChapterProgressMessage(chapterKey, payload)
    } catch (error) {
      logger.error('❌ Failed to send chapter progress update message:', error)
    }
  }

  private clearPendingChapterProgress(chapterKey: string): void {
    const pendingEntry = this.pendingChapterProgress.get(chapterKey)
    if (!pendingEntry) {
      return
    }

    clearTimeout(pendingEntry.timerId)
    this.pendingChapterProgress.delete(chapterKey)
  }

  private schedulePendingChapterProgress(
    chapterKey: string,
    payload: OffscreenDownloadProgressMessage['payload'],
    delayMs: number,
  ): void {
    const existingEntry = this.pendingChapterProgress.get(chapterKey)
    if (existingEntry) {
      clearTimeout(existingEntry.timerId)
    }

    const timerId = setTimeout(() => {
      const pendingEntry = this.pendingChapterProgress.get(chapterKey)
      if (!pendingEntry || pendingEntry.timerId !== timerId) {
        return
      }

      this.pendingChapterProgress.delete(chapterKey)
      void this.dispatchChapterProgressMessage(chapterKey, pendingEntry.payload).catch((error) => {
        logger.error('❌ Failed to flush throttled chapter progress update:', error)
      })
    }, Math.max(0, delayMs))

    this.pendingChapterProgress.set(chapterKey, {
      payload,
      timerId,
    })
  }

  private async dispatchChapterProgressMessage(
    chapterKey: string,
    payload: OffscreenDownloadProgressMessage['payload'],
  ): Promise<void> {
    await this.sendMessageWithRetry(
      {
        type: 'OFFSCREEN_DOWNLOAD_PROGRESS',
        payload,
      } as OffscreenDownloadProgressMessage,
      3,
      250,
    )
    this.chapterProgressLastSentAt.set(chapterKey, Date.now())
    logger.debug(`📊 Sent chapter progress update ${payload.taskId}/${payload.chapterId}:`, payload)
  }


  // Runtime message retry with small backoff to tolerate transient SW wakeups
  private async sendMessageWithRetry<T extends import('@/src/types/extension-messages').ExtensionMessage, R>(msg: T, attempts = 3, baseDelayMs = 250): Promise<R> {
    let lastError: Error | undefined;
    for (let i = 0; i < attempts; i++) {
      try {
        return await chrome.runtime.sendMessage<T, R>(msg);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error('sendMessage failed', { cause: e }); // Ref: https://github.com/typescript-eslint/typescript-eslint/blob/main/packages/eslint-plugin/docs/rules/only-throw-error.mdx
        const delay = baseDelayMs * Math.pow(2, i);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    if (lastError) throw lastError;
    throw new Error('sendMessage failed after retries');
  }

  getActiveJobCount(): number {
    return this.activeTaskControllers.size
  }

  cancelTask(taskId: string): boolean {
    const taskControllerEntry = this.activeTaskControllers.get(taskId)
    if (!taskControllerEntry) {
      return false
    }

    try {
      taskControllerEntry.controller.abort('User cancelled')
    } catch (error) {
      logger.debug('Failed to abort task controller (non-fatal):', error)
    }

    return true
  }
}

const worker = new OffscreenWorker()
const statusController = createOffscreenStatusController(worker)

registerOffscreenRuntime(worker, {
  onInitialized: () => {
    statusController.onInitialized()
  },
  onInitializationError: (errorMessage: string) => {
    statusController.onInitializationError(errorMessage)
  },
})

// Initialize when document loads
document.addEventListener('DOMContentLoaded', () => {
  try {
    statusController.initializeDom()
  } catch (error) {
    statusController.reportBootstrapError(error)
  }
})

// NOTE: Offscreen documents can ONLY use chrome.runtime API, NOT chrome.storage
// The previous chrome.storage.session listener caused TypeError because chrome.storage is undefined in offscreen context
// All work dispatch happens via chrome.runtime.sendMessage handled in processMessage() above

logger.debug('✅ Offscreen document script loaded')


