/**
 * Offscreen Document - New Centralized State Architecture
 * 
 * This refactored offscreen document:
 * - Uses chrome.storage.session to sync with Service Worker
 * - Listens to storage changes for work requests
 * - Reports progress through state updates
 * - Handles archive creation with Web Workers for performance
 */

import type { Chapter } from '@/src/types/chapter'
import {
  PromiseQueue,
  withRetries,
  fetchChapterHtml
} from './image-processor'
import { siteIntegrationRegistry } from '@/src/runtime/site-integration-registry'
import logger from '@/src/runtime/logger'
import { loadDownloadRootHandle, verifyPermission, writeBlobToPath } from '@/src/storage/fs-access'
import type { TaskSettingsSnapshot } from '@/src/types/state-snapshots'
import type {
  OffscreenDownloadChapterMessage,
  OffscreenDownloadProgressMessage,
} from '@/src/types/offscreen-messages'
import { sendStateAction } from '@/src/runtime/state-actions'
import { StateAction } from '@/src/types/state-actions'
import { resolveEffectiveRetries } from '@/src/shared/settings-utils'
import { scheduleForIntegrationScope } from '@/src/runtime/rate-limit'
import { generateComicInfo } from '@/src/shared/comicinfo-generator'
import { sanitizeFilename, normalizeImageFilename } from '@/src/shared/filename-sanitizer';
import ZipWorker from './zip.worker.ts?worker';
import {
  buildComicInfoMetadata,
  sendThrottledDownloadApiRequest,
  type SeriesMetadataInput,
} from './helpers'
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

type ChapterOutcomeStatus = 'completed' | 'partial_success' | 'failed'

type ChapterOutcome = {
  status: ChapterOutcomeStatus
  errorMessage?: string
  imagesFailed?: number
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
  private readonly chapterProgressLastSentAt = new Map<string, number>()
  private readonly activeTaskControllers = new Map<string, { controller: AbortController; activeCount: number; createdAt: number }>()

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

  private buildImageOutputFilename(input: {
    index: number
    totalImages: number
    originalFilename: string
    mimeType: string
    normalizeImageFilenames: boolean
    imagePaddingDigits: 'auto' | 2 | 3 | 4 | 5
  }): string {
    const { index, totalImages, originalFilename, mimeType, normalizeImageFilenames, imagePaddingDigits } = input
    if (normalizeImageFilenames) {
      return normalizeImageFilename(index, totalImages, mimeType, imagePaddingDigits)
    }

    return `${String(index + 1).padStart(3, '0')}-${originalFilename}.${mimeType?.includes('png') ? 'png' : mimeType?.includes('webp') ? 'webp' : 'jpg'}`
  }

  private buildCoverOutputFilename(mimeType: string): string {
    const extension = mimeType?.includes('png') ? 'png' : mimeType?.includes('webp') ? 'webp' : 'jpg'
    return `000-cover.${extension}`
  }

  private normalizeDownloadPath(path: string): string {
    let normalized = path.replace(/\\/g, '/').replace(/^[/.]+/, '')
    normalized = normalized.split('/').filter(Boolean).join('/')
    return normalized
  }

  private async emitFsaFallbackProgress(taskId: string, chapter: Chapter, totalImages: number): Promise<void> {
    await this.sendChapterProgressMessage({
      taskId,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      status: 'downloading',
      imagesProcessed: 0,
      imagesFailed: 0,
      totalImages,
      fsaFallbackTriggered: true,
    })
  }

  // Resolve effective retry counts: site override > global settings
  // private async resolveEffectiveRetries moved to @/src/shared/settings-utils

  public async processDownloadChapter(
    request: OffscreenDownloadChapterMessage['payload']
  ): Promise<ChapterOutcome> {
    let taskControllerEntry = this.activeTaskControllers.get(request.taskId)
    if (!taskControllerEntry || taskControllerEntry.controller.signal.aborted) {
      taskControllerEntry = {
        controller: new AbortController(),
        activeCount: 0,
        createdAt: Date.now(),
      }
      this.activeTaskControllers.set(request.taskId, taskControllerEntry)
    }
    taskControllerEntry.activeCount += 1

    const snapshot = request.settingsSnapshot as Partial<{
      archiveFormat: 'cbz' | 'zip' | 'none';
      overwriteExisting: boolean;
      includeComicInfo: boolean;
      includeCoverImage: boolean;
    }>;

    const chapterForProcessing: Chapter = {
      id: request.chapter.id,
      url: request.chapter.url,
      title: request.chapter.title,
      chapterLabel: request.chapter.chapterLabel,
      chapterNumber: request.chapter.chapterNumber,
      volumeNumber: request.chapter.volumeNumber,
      volumeLabel: request.chapter.volumeLabel,
      language: request.chapter.language,
      resolvedPath: request.chapter.resolvedPath,
      comicInfo: request.chapter.language ? { LanguageISO: request.chapter.language } : {},
    };

    this.currentIntegrationId = request.book.siteIntegrationId;
    this.currentRetries = await resolveEffectiveRetries(this.currentIntegrationId);

    try {
      await this.sendMessageWithRetry(
        {
          type: 'OFFSCREEN_DOWNLOAD_PROGRESS',
          payload: {
            taskId: request.taskId,
            chapterId: request.chapter.id,
            chapterTitle: request.chapter.title,
            status: 'downloading',
            imagesProcessed: 0,
            imagesFailed: 0,
            totalImages: 0,
          },
        } as OffscreenDownloadProgressMessage,
        3,
        250,
      )
    } catch (error) {
      logger.debug('Failed to send initial offscreen startup heartbeat (non-fatal):', error)
    }

    let coverImage: { data: ArrayBuffer; mimeType: string } | undefined;
    const includeCoverImage = snapshot.includeCoverImage ?? true;
    if (includeCoverImage && request.book.coverUrl) {
      try {
        const integrationInfo = siteIntegrationRegistry.findById(this.currentIntegrationId);
        if (integrationInfo?.integration) {
          const imageRetries = this.currentRetries?.image ?? 1;
          const result = await withRetries(() =>
            scheduleForIntegrationScope(this.currentIntegrationId!, 'image', () =>
              integrationInfo.integration!.background.chapter.downloadImage(request.book.coverUrl!, {
                context: request.integrationContext,
              })
            ),
            imageRetries,
          );
          coverImage = { data: result.data, mimeType: result.mimeType };
        }
      } catch (error) {
        logger.debug('Single chapter cover image fetch failed (non-fatal):', error);
      }
    }

    const latestImageProgress = { current: 0, total: 0 }

    try {
      return await this.processChapterStreaming({
        taskId: request.taskId,
        chapter: chapterForProcessing,
        seriesTitle: request.book.seriesTitle,
        format: snapshot.archiveFormat ?? 'cbz',
        includeComicInfo: snapshot.includeComicInfo ?? true,
        downloadMode: request.saveMode === 'fsa' ? 'custom' : 'browser',
        overwriteExisting: snapshot.overwriteExisting ?? false,
        comicInfoVersion: '2.0',
        abortSignal: taskControllerEntry.controller.signal,
        onProgress: async (...args) => {
          const imageProgress = args[2]
          if (imageProgress) {
            latestImageProgress.current = imageProgress.current
            latestImageProgress.total = imageProgress.total
          }
          await this.sendChapterProgressMessage({
            taskId: request.taskId,
            chapterId: request.chapter.id,
            chapterTitle: request.chapter.title,
            status: 'downloading',
            imagesProcessed: latestImageProgress.current,
            imagesFailed: 0,
            totalImages: latestImageProgress.total,
          });
        },
        onArchiveProgress: async () => {
          await this.sendChapterProgressMessage({
            taskId: request.taskId,
            chapterId: request.chapter.id,
            chapterTitle: request.chapter.title,
            status: 'downloading',
            imagesProcessed: latestImageProgress.current,
            imagesFailed: 0,
            totalImages: latestImageProgress.total,
          });
        },
        coverImage,
        integrationContext: request.integrationContext,
        seriesMetadata: request.book.metadata,
        settingsSnapshot: request.settingsSnapshot,
      });
    } finally {
      const currentTaskControllerEntry = this.activeTaskControllers.get(request.taskId)
      if (currentTaskControllerEntry && currentTaskControllerEntry.controller === taskControllerEntry.controller) {
        currentTaskControllerEntry.activeCount -= 1
        if (currentTaskControllerEntry.activeCount <= 0) {
          this.activeTaskControllers.delete(request.taskId)
        }
      }
    }
  }

  // Stream images directly into a ZIP worker and save archive without buffering full chapter in memory
  private async processChapterStreaming(opts: {
    taskId: string;
    chapter: Chapter;
    seriesTitle: string;
    format: 'cbz' | 'zip' | 'none';
    includeComicInfo: boolean | undefined;
    downloadMode: 'browser' | 'custom';
    overwriteExisting: boolean;
    comicInfoVersion: '2.0';  // P1-3: Always v2.0
    onProgress: (pct: number, label?: string, imageProgress?: { current: number; total: number }) => Promise<void>;
    onArchiveProgress: (pct: number, label?: string) => Promise<void>;
    abortSignal?: AbortSignal;
    // Image filename normalization settings
    normalizeImageFilenames?: boolean;
    imagePaddingDigits?: 'auto' | 2 | 3 | 4 | 5;
    coverImage?: { data: ArrayBuffer; mimeType: string };
    onImageDownloaded?: () => void;
    integrationContext?: Record<string, unknown>;
    seriesMetadata?: SeriesMetadataInput;
    settingsSnapshot?: TaskSettingsSnapshot;
  }): Promise<ChapterOutcome> {
    const { taskId, chapter, seriesTitle, format, includeComicInfo, downloadMode, comicInfoVersion, onProgress, onArchiveProgress, abortSignal, coverImage, seriesMetadata } = opts;
    // Extract normalization settings from opts for use in no-archive format
    const normalizeSettings = {
      normalizeImageFilenames: opts.normalizeImageFilenames ?? true,
      imagePaddingDigits: opts.imagePaddingDigits ?? 'auto'
    };
    try {
      // Find site integration using the integration ID passed with the chapter dispatch payload.
      const integrationId = this.currentIntegrationId;
      if (!integrationId) throw new Error('No integration ID available - processDownloadChapter must be called first');
      const integrationInfo = siteIntegrationRegistry.findById(integrationId);
      if (!integrationInfo || !integrationInfo.integration) throw new Error(`No site integration found for ID: ${integrationId}`);
      const backgroundIntegration = integrationInfo.integration.background;

      // Resolve image URLs using either the canonical integration resolver or an HTML parsing fallback.
      await onProgress(5, 'fetching');
      if (abortSignal?.aborted) throw new Error('job-cancelled');
      const chapterRetries = this.currentRetries?.chapter ?? 1;
      await onProgress(10, 'parsing');
      const urls = backgroundIntegration.chapter.resolveImageUrls
        ? await backgroundIntegration.chapter.resolveImageUrls(
          { id: chapter.id, url: chapter.url },
          opts.integrationContext,
          opts.settingsSnapshot ? { ...opts.settingsSnapshot } : undefined,
        )
        : await (async () => {
          const parseImageUrlsFromHtml = backgroundIntegration.chapter.parseImageUrlsFromHtml;
          if (!parseImageUrlsFromHtml) {
            throw new Error(`Site integration ${integrationId} does not implement resolveImageUrls or parseImageUrlsFromHtml`);
          }

          let html = '';
          let htmlFetchErrorMessage: string | undefined;
          try {
            html = await withRetries(
              () => fetchChapterHtml(chapter.url, OffscreenWorker.DEFAULT_FETCH_TIMEOUT_MS, integrationId),
              chapterRetries,
            );
          } catch (e) {
            htmlFetchErrorMessage = e instanceof Error ? e.message : (typeof e === 'string' ? e : undefined);
            html = '';
          }

          const raw = await parseImageUrlsFromHtml({
            chapterId: chapter.id,
            chapterUrl: chapter.url,
            chapterHtml: html,
          });
          if (raw.length === 0 && htmlFetchErrorMessage) {
            throw new Error(`Failed to fetch chapter HTML: ${htmlFetchErrorMessage}`);
          }
          return backgroundIntegration.chapter.processImageUrls(raw, chapter);
        })();
      if (urls.length === 0) {
        throw new Error('No images found');
      }

      await onProgress(10, 'ready', { current: 0, total: urls.length });

      // If 'none' format, just download images then save to a folder
      if (format === 'none') {
        const images: Array<{ index: number; filename: string; data: ArrayBuffer; mimeType: string }> = [];
        const downloadQueue = new PromiseQueue(16);
        let processed = 0;
        const total = urls.length;
        let failed = 0;
        const failedUrls: string[] = []; // Track failed URLs for debugging
        const imageDownloadContext = {
          ...(opts.integrationContext ?? {}),
          chapterId: chapter.id,
        };

        const tasks: Promise<void>[] = [];
        for (let i = 0; i < urls.length; i++) {
          const u = urls[i];
          const imageIndex = i;
          tasks.push(downloadQueue.add(async () => {
            try {
              if (abortSignal?.aborted) throw new Error('job-cancelled');
              const imageRetries = this.currentRetries?.image ?? 1;
              const r = await withRetries<{ filename: string; data: ArrayBuffer; mimeType: string }>(
                () => scheduleForIntegrationScope(integrationId, 'image', () => backgroundIntegration.chapter.downloadImage(u, {
                  signal: abortSignal,
                  context: imageDownloadContext,
                }))
                , imageRetries);
              images.push({ index: imageIndex, filename: sanitizeFilename(r.filename), data: r.data, mimeType: r.mimeType });
              if (opts.onImageDownloaded) opts.onImageDownloaded();
            } catch (e) {
              failed++;
              failedUrls.push(u);
              logger.warn(`⚠️ Image download failed (skipped): ${u}`, e);
            } finally {
              processed++;
              const pct = Math.max(10, Math.round((processed / total) * 100));
              await onProgress(pct, undefined, { current: processed, total });
            }
          }));
        }
        await Promise.allSettled(tasks);

        // Sort images by index (important since concurrent downloads may complete out-of-order)
        images.sort((a, b) => a.index - b.index);

        // Save each image to the chapter directory
        const chapterDir = chapter.resolvedPath || sanitizeFilename(chapter.title);
        if (downloadMode === 'custom') {
          let writeStarted = false;
          try {
            const dir = await loadDownloadRootHandle();
            if (!dir) {
              await this.emitFsaFallbackProgress(taskId, chapter, total)
            } else if (!(await verifyPermission(dir, true))) {
              await this.emitFsaFallbackProgress(taskId, chapter, total)
            } else {
              if (coverImage) {
                const coverPath = `${chapterDir}/${this.buildCoverOutputFilename(coverImage.mimeType)}`
                writeStarted = true;
                logger.debug('Writing cover image to custom folder for NONE format', { chapterDir, coverPath })
                await writeBlobToPath(dir, coverPath, new Blob([coverImage.data], { type: coverImage.mimeType || 'application/octet-stream' }), true)
              }

              // Write each image as separate file under chapterDir
              for (const img of images) {
                // Use normalized filename if setting enabled (defaults to true)
                const filename = this.buildImageOutputFilename({
                  index: img.index,
                  totalImages: total,
                  originalFilename: img.filename,
                  mimeType: img.mimeType,
                  normalizeImageFilenames: normalizeSettings.normalizeImageFilenames,
                  imagePaddingDigits: normalizeSettings.imagePaddingDigits,
                })
                const filePath = `${chapterDir}/${filename}`;
                writeStarted = true;
                await writeBlobToPath(dir, filePath, new Blob([img.data], { type: img.mimeType || 'application/octet-stream' }), true);
              }

              // Save ComicInfo.xml as separate file if enabled
              if (includeComicInfo) {
                const pageCount = images.length + (coverImage ? 1 : 0)
                const metadata = buildComicInfoMetadata({
                  chapter,
                  seriesTitle,
                  seriesMetadata,
                  pageCount,
                  hasCoverImage: !!coverImage,
                })
                const comicInfoXml = generateComicInfo(metadata, pageCount, comicInfoVersion, !!coverImage);
                if (comicInfoXml) {
                  const comicInfoPath = `${chapterDir}/ComicInfo.xml`;
                  writeStarted = true;
                  await writeBlobToPath(dir, comicInfoPath, new Blob([comicInfoXml], { type: 'application/xml' }), true);
                }
              }

              await onArchiveProgress(100, 'saved');
              if (failed > 0) {
                const succeededFromUrls = total - failed;
                if (succeededFromUrls > 0) {
                  logger.warn(`Partial success (custom): ${succeededFromUrls} succeeded, ${failed} failed`);
                  return { status: 'partial_success', errorMessage: `${failed}/${total} images failed`, imagesFailed: failed };
                }
                return { status: 'failed', errorMessage: `All images failed (${failed}/${total})`, imagesFailed: failed };
              }
              return { status: 'completed' };
            }
          } catch (e) {
            await this.emitFsaFallbackProgress(taskId, chapter, total)
            if (writeStarted) {
              await onProgress(0, 'Retrying with browser downloads');
              logger.warn('Custom folder write failed mid-download. Reprocessing chapter with browser downloads.', e);
              return this.processChapterStreaming({
                ...opts,
                downloadMode: 'browser',
              });
            }
            logger.debug('custom folder write failed; fallback to browser', e);

          }
        }

        // Browser mode: request downloads for each image (may be throttled by browser)
        if (coverImage) {
          const coverPath = `${chapterDir}/${this.buildCoverOutputFilename(coverImage.mimeType)}`.replace(/\\/g, '/');
          const coverBlob = new Blob([coverImage.data], { type: coverImage.mimeType || 'application/octet-stream' });
          const coverFileUrl = URL.createObjectURL(coverBlob);
          logger.debug('Requesting browser download for NONE-format cover image', { chapterDir, coverPath })
          const coverResp = await sendThrottledDownloadApiRequest({
            taskId,
            chapterId: chapter.id,
            fileUrl: coverFileUrl,
            filename: coverPath,
          });
          if (!coverResp || coverResp.success !== true) { logger.debug('cover image download request failed', coverResp); }
        }

        for (const img of images) {
          // Use normalized filename if setting enabled (defaults to true)
          const filename = this.buildImageOutputFilename({
            index: img.index,
            totalImages: total,
            originalFilename: img.filename,
            mimeType: img.mimeType,
            normalizeImageFilenames: normalizeSettings.normalizeImageFilenames,
            imagePaddingDigits: normalizeSettings.imagePaddingDigits,
          })
          const filePath = `${chapterDir}/${filename}`.replace(/\\/g, '/');
          const blob = new Blob([img.data], { type: img.mimeType || 'application/octet-stream' });
          const fileUrl = URL.createObjectURL(blob);
          const resp = await sendThrottledDownloadApiRequest({
            taskId,
            chapterId: chapter.id,
            fileUrl,
            filename: filePath,
          });
          if (!resp || resp.success !== true) { logger.debug('image download request failed', resp); }
        }

        // Download ComicInfo.xml as separate file if enabled
        if (includeComicInfo) {
          const pageCount = images.length + (coverImage ? 1 : 0)
          const metadata = buildComicInfoMetadata({
            chapter,
            seriesTitle,
            seriesMetadata,
            pageCount,
            hasCoverImage: !!coverImage,
          })
          const comicInfoXml = generateComicInfo(metadata, pageCount, comicInfoVersion, !!coverImage);
          if (comicInfoXml) {
            const comicInfoPath = `${chapterDir}/ComicInfo.xml`.replace(/\\/g, '/');
            const comicInfoBlob = new Blob([comicInfoXml], { type: 'application/xml' });
            const comicInfoFileUrl = URL.createObjectURL(comicInfoBlob);
            const comicInfoResp = await sendThrottledDownloadApiRequest({
              taskId,
              chapterId: chapter.id,
              fileUrl: comicInfoFileUrl,
              filename: comicInfoPath,
            });
            if (!comicInfoResp || comicInfoResp.success !== true) { logger.debug('ComicInfo.xml download request failed', comicInfoResp); }
          }
        }

        await onArchiveProgress(100, 'download started');
        if (failed > 0) {
          const succeededFromUrls = total - failed;
          if (succeededFromUrls > 0) {
            logger.warn(`Partial success (browser): ${succeededFromUrls} succeeded, ${failed} failed`);
            return { status: 'partial_success', errorMessage: `${failed}/${total} images failed`, imagesFailed: failed };
          }
          return { status: 'failed', errorMessage: `All images failed (${failed}/${total})`, imagesFailed: failed };
        }
        return { status: 'completed' };
      }

      // Create a streaming ZIP worker for cbz/zip
      await onArchiveProgress(5, 'starting archive');
      const worker = new ZipWorker();

      // Track completion via promise
      type WorkerZipResult = { success: boolean; buffer?: ArrayBuffer; filename?: string; size?: number; imageCount?: number; format?: string; error?: string };
      let resolveResult!: (v: WorkerZipResult) => void;
      let rejectResult!: (e: unknown) => void;
      const resultP = new Promise<WorkerZipResult>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
      const timeout = setTimeout(() => { try { worker.terminate(); } catch (e) { logger.debug('zip worker terminate failed (non-fatal)', e); } rejectResult(new Error('Zip worker timed out')); }, 5 * 60 * 1000);
      worker.onmessage = (ev: MessageEvent<WorkerZipResult>) => { clearTimeout(timeout); resolveResult(ev.data); };
      worker.onerror = (e) => {
        clearTimeout(timeout);
        const workerError = e.error instanceof Error
          ? e.error
          : new Error(
            e.message
              ? `Zip worker error: ${e.message}${e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : ''}`
              : 'Zip worker error',
          );
        rejectResult(workerError);
      };

      // Initialize worker with normalization settings (from normalizeSettings object)
      // normalizeImageFilenames defaults to true, imagePaddingDigits defaults to 'auto'
      worker.postMessage({
        type: 'init',
        chapterTitle: sanitizeFilename(chapter.title),
        extension: format,
        normalizeImageFilenames: normalizeSettings.normalizeImageFilenames,
        imagePaddingDigits: normalizeSettings.imagePaddingDigits,
        totalImages: urls.length + (coverImage ? 1 : 0)
      });

      // Add ComicInfo.xml FIRST (ComicInfo.xml must be first entry)
      // Note: PageCount will be approximate since we don't know final count yet (some images may fail)
      // This is acceptable per ZIP spec and comic readers handle it gracefully
      if (includeComicInfo) {
        const pageCount = urls.length + (coverImage ? 1 : 0)
        const metadata = buildComicInfoMetadata({
          chapter,
          seriesTitle,
          seriesMetadata,
          pageCount,
          hasCoverImage: !!coverImage,
        })
        const xml = generateComicInfo(metadata, pageCount, comicInfoVersion, !!coverImage);
        if (xml) {
          worker.postMessage({ type: 'addComicInfo', xml });
          logger.debug(`📋 Added ComicInfo.xml as first entry (${urls.length + (coverImage ? 1 : 0)} pages estimated)`);
        }
      }

      // Add cover image to archive if present
      if (coverImage) {
        const ext = coverImage.mimeType.includes('png') ? 'png' : coverImage.mimeType.includes('webp') ? 'webp' : 'jpg';
        const coverFilename = `000-cover.${ext}`;
        const coverBuffer = coverImage.data.slice(0); // Clone buffer for transfer
        worker.postMessage({
          type: 'addImage',
          filename: coverFilename,
          buffer: coverBuffer,
          index: 0,
          mimeType: coverImage.mimeType
        }, [coverBuffer]);
      }

      // Download images with concurrency, streaming each into the ZIP
      const downloadQueue = new PromiseQueue(16);
      let processed = 0;
      let succeeded = 0;
      let failed = 0;
      const total = urls.length;
      const failedUrls: string[] = []; // Track failed URLs for debugging
      const failedReasons: string[] = [];
      const imageDownloadContext = {
        ...(opts.integrationContext ?? {}),
        chapterId: chapter.id,
      };

      const tasks: Promise<void>[] = [];
      for (let i = 0; i < urls.length; i++) {
        const u = urls[i];
        const imageIndex = i + (coverImage ? 1 : 0); // Shift index if cover exists
        tasks.push(downloadQueue.add(async () => {
          try {
            if (abortSignal?.aborted) throw new Error('job-cancelled');
            const imageRetries = this.currentRetries?.image ?? 1;
            const r = await withRetries<{ filename: string; data: ArrayBuffer; mimeType: string }>(
              () => scheduleForIntegrationScope(integrationId, 'image', () => backgroundIntegration.chapter.downloadImage(u, {
                signal: abortSignal,
                context: imageDownloadContext,
              }))
              , imageRetries);
            const name = sanitizeFilename(r.filename);
            const buf = r.data; // ArrayBuffer
            // stream to worker with index and mimeType for normalization
            worker.postMessage({
              type: 'addImage',
              filename: name,
              buffer: buf,
              index: imageIndex,
              mimeType: r.mimeType
            }, [buf]);
            succeeded++;
            if (opts.onImageDownloaded) opts.onImageDownloaded();
          } catch (e) {
            failed++;
            failedUrls.push(u);
            const reason = e instanceof Error ? e.message : String(e);
            if (failedReasons.length < 3) {
              failedReasons.push(`${u} => ${reason}`);
            }
            logger.warn(`⚠️ Image download failed (${failed}/${total}): ${u}`, e);
          } finally {
            processed++;
            const pct = Math.max(10, Math.round((processed / total) * 100));
            await onProgress(pct, undefined, { current: processed, total });
          }
        }));
      }
      await Promise.allSettled(tasks);

      // Finalize archive (Archive finalization after all images)
      await onArchiveProgress(90, 'finalizing');
      if (abortSignal?.aborted) throw new Error('job-cancelled');

      // Log final stats before finalization with accurate success/fail counts
      if (failed > 0) {
        logger.warn(`📦 Finalizing archive: ${succeeded}/${total} images succeeded, ${failed} failed`);
        if (failedUrls.length > 0) {
          logger.warn(`⚠️ Some images failed to download: ${failedUrls.length}/${total}`);
          if (failedUrls.length > 0) {
            logger.warn(`   First 10 failed URLs:`, failedUrls.slice(0, 10));
          }
        }
      } else {
        logger.debug(`📦 Finalizing archive: ${succeeded}/${total} images downloaded successfully`);
      }

      // Image Failure Semantics:
      // - For CBZ/ZIP: ANY image failure = chapter failed, discard partial archive
      // - For NONE format: ANY image failure = partial_success, keep downloaded images (handled separately)
      const isArchiveFormat = format === 'cbz' || format === 'zip';
      if (failed > 0 && isArchiveFormat) {
        const reasonSummary = failedReasons.length > 0
          ? ` reasons: ${failedReasons.join(' | ')}`
          : '';
        const errorMsg = `Image download failed: ${failed}/${total} images could not be downloaded${reasonSummary} (${failedUrls.slice(0, 3).join(', ')}${failed > 3 ? '...' : ''})`;
        logger.error(`❌ Chapter failed due to image failure(s) - discarding partial archive`);
        logger.error(`   Chapter: ${chapter.title}`);
        logger.error(`   Format: ${format} (archive format - partial archives not allowed)`);
        logger.error(`   ${succeeded}/${total} succeeded, ${failed} failed`);
        return { status: 'failed', errorMessage: errorMsg, imagesFailed: failed };
      }

      worker.postMessage({ type: 'finalize' });
      const res = await resultP;

      // Enhanced error handling: Clear error messages for compression failures
      if (!res?.success || !res.buffer) {
        const errorMsg = res?.error || 'Archive creation failed';
        logger.error(`❌ Archive creation failed: ${errorMsg}`);
        logger.error(`   Chapter: ${chapter.title}`);
        logger.error(`   Images: ${succeeded}/${total} succeeded, ${failed} failed`);
        logger.error(`   Format: ${format}`);

        // Log memory stats if available
        const memStats = this.getMemoryStats();
        if (memStats) {
          logger.error(`   Memory at failure: ${memStats.usedMB.toFixed(1)}MB / ${memStats.totalMB.toFixed(1)}MB`);
        }

        throw new Error(`Archive creation failed: ${errorMsg} (${succeeded}/${total} images, ${failed} failed)`);
      }

      await onArchiveProgress(95, 'preparing download');

      // Save via background/custom folder
      // Use application/octet-stream to prevent Chrome from appending .zip based on MIME type
      const mimeType = format === 'cbz' ? 'application/x-cbz' : 'application/zip';
      const blob = new Blob([res.buffer], { type: mimeType });
      const finalPath = chapter.resolvedPath || `${sanitizeFilename(chapter.title)}.${format}`;
      logger.debug(`[Archive Download] format=${format}, finalPath=${finalPath}`);

      if (downloadMode === 'custom') {
        let writeStarted = false;
        try {
          const dir = await loadDownloadRootHandle();
          if (!dir) {
            await this.emitFsaFallbackProgress(taskId, chapter, total)

          } else if (!(await verifyPermission(dir, true))) {
            await this.emitFsaFallbackProgress(taskId, chapter, total)

          } else {
            writeStarted = true;
            await writeBlobToPath(dir, finalPath, blob, true);
            await onArchiveProgress(100, 'saved');
            return { status: 'completed' };
          }
        } catch (e) {
          await this.emitFsaFallbackProgress(taskId, chapter, total)
          if (writeStarted) {
            await onProgress(0, 'Retrying with browser downloads');
            logger.warn('Custom folder archive write failed mid-download. Reprocessing chapter with browser downloads.', e);
            return this.processChapterStreaming({
              ...opts,
              downloadMode: 'browser',
            });
          }
          logger.debug('custom folder write failed; will fallback to browser downloads', e);
          // Notify user about fallback to browser download folder

        }
      }

      const normalized = this.normalizeDownloadPath(finalPath);
      const fileUrl = URL.createObjectURL(blob);
      const resp = await sendThrottledDownloadApiRequest({
        taskId,
        chapterId: chapter.id,
        fileUrl,
        filename: normalized,
      });
      if (!resp || resp.success !== true) {
        const errorMessage = resp && 'error' in resp ? resp.error : 'background downloads.download failed';
        throw new Error(errorMessage);
      }
      await onArchiveProgress(100, 'download started');

      return { status: 'completed' };
    } catch (e) {
      // Treat job cancellation as a normal flow (debug-level), others as errors
      const msg = e instanceof Error ? e.message : (typeof e === 'string' ? e : 'Unknown error');
      if (typeof msg === 'string' && msg.toLowerCase().includes('job-cancelled')) {
        logger.debug('processChapterStreaming cancelled');
      } else {
        logger.error('processChapterStreaming failed:', e);
      }
      return { status: 'failed', errorMessage: msg };
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
      const chapterKey = `${payload.taskId}:${payload.chapterId}`;
      const previousSentAt = this.chapterProgressLastSentAt.get(chapterKey) ?? 0;
      if (payload.status === 'downloading' && previousSentAt > 0 && Date.now() - previousSentAt < 250) {
        return;
      }

      await this.sendMessageWithRetry(
        {
          type: 'OFFSCREEN_DOWNLOAD_PROGRESS',
          payload,
        } as OffscreenDownloadProgressMessage,
        3,
        250
      );
      this.chapterProgressLastSentAt.set(chapterKey, Date.now());
      logger.debug(`📊 Sent chapter progress update ${payload.taskId}/${payload.chapterId}:`, payload);
    } catch (error) {
      logger.error('❌ Failed to send chapter progress update message:', error);
    }
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


