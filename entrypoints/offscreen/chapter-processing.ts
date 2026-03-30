import type { Chapter } from '@/src/types/chapter'
import logger from '@/src/runtime/logger'
import { sanitizeFilename } from '@/src/shared/filename-sanitizer'
import { writeBlobToPath } from '@/src/storage/fs-access'
import ZipWorker from './zip.worker.ts?worker'
import { downloadChapterImages } from './chapter-image-downloads'
import {
  buildCoverOutputFilename,
  buildImageOutputFilename,
  buildOptionalComicInfoXml,
  normalizeDownloadPath,
} from './chapter-processing-helpers'
import type {
  ArchiveNormalizationSettings,
  ChapterDownloadImageFn,
  ChapterOutcome,
  ChapterProcessingRuntime,
  ProcessChapterStreamingOptions,
  WorkerZipResult,
} from './chapter-processing-types'
import type { SeriesMetadataInput } from './helpers'

export type {
  ArchiveNormalizationSettings,
  BrowserBlobDownloadResponse,
  ChapterDownloadImageFn,
  ChapterDownloadImageResult,
  ChapterOutcome,
  ChapterOutcomeStatus,
  ChapterProcessingRuntime,
  ErrorCategory,
  ProcessChapterStreamingOptions,
  ProcessDownloadChapterSettingsSnapshot,
  WorkerZipResult,
} from './chapter-processing-types'

type DownloadedChapterImage = {
  index: number
  filename: string
  data: ArrayBuffer
  mimeType: string
}

function createArchiveWorker(): { worker: Worker; resultPromise: Promise<WorkerZipResult> } {
  const worker = new ZipWorker()

  let resolveResult!: (value: WorkerZipResult) => void
  let rejectResult!: (error: unknown) => void
  const resultPromise = new Promise<WorkerZipResult>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })

  const timeout = setTimeout(() => {
    try {
      worker.terminate()
    } catch (error) {
      logger.debug('zip worker terminate failed (non-fatal)', error)
    }
    rejectResult(new Error('Zip worker timed out'))
  }, 5 * 60 * 1000)

  worker.onmessage = (event: MessageEvent<WorkerZipResult>) => {
    clearTimeout(timeout)
    resolveResult(event.data)
  }
  worker.onerror = (event) => {
    clearTimeout(timeout)
    const workerError = event.error instanceof Error
      ? event.error
      : new Error(
        event.message
          ? `Zip worker error: ${event.message}${event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : ''}`
          : 'Zip worker error',
      )
    rejectResult(workerError)
  }

  return { worker, resultPromise }
}

function initializeArchiveWorker(input: {
  worker: Worker
  chapter: Chapter
  format: 'cbz' | 'zip'
  normalizeSettings: ArchiveNormalizationSettings
  totalImages: number
}): void {
  const { worker, chapter, format, normalizeSettings, totalImages } = input
  worker.postMessage({
    type: 'init',
    chapterTitle: sanitizeFilename(chapter.title),
    extension: format,
    normalizeImageFilenames: normalizeSettings.normalizeImageFilenames,
    imagePaddingDigits: normalizeSettings.imagePaddingDigits,
    totalImages,
  })
}

function addComicInfoToArchiveWorker(input: {
  worker: Worker
  includeComicInfo: boolean | undefined
  chapter: Chapter
  seriesTitle: string
  seriesMetadata?: SeriesMetadataInput
  pageCount: number
  comicInfoVersion: '2.0'
  hasCoverImage: boolean
}): void {
  const { worker, includeComicInfo, chapter, seriesTitle, seriesMetadata, pageCount, comicInfoVersion, hasCoverImage } = input
  const xml = buildOptionalComicInfoXml({
    includeComicInfo,
    chapter,
    seriesTitle,
    seriesMetadata,
    pageCount,
    comicInfoVersion,
    hasCoverImage,
  })
  if (!xml) {
    return
  }

  worker.postMessage({ type: 'addComicInfo', xml })
  logger.debug(`📋 Added ComicInfo.xml as first entry (${pageCount} pages estimated)`)
}

function addCoverToArchiveWorker(worker: Worker, coverImage?: { data: ArrayBuffer; mimeType: string }): void {
  if (!coverImage) {
    return
  }

  const coverBuffer = coverImage.data.slice(0)
  worker.postMessage({
    type: 'addImage',
    filename: buildCoverOutputFilename(coverImage.mimeType),
    buffer: coverBuffer,
    index: 0,
    mimeType: coverImage.mimeType,
  }, [coverBuffer])
}

function createNoneFormatChapterOutcome(input: {
  downloadMode: 'browser' | 'custom'
  totalImages: number
  failedImages: number
}): ChapterOutcome {
  const { downloadMode, totalImages, failedImages } = input
  if (failedImages > 0) {
    const succeededImages = totalImages - failedImages
    if (succeededImages > 0) {
      logger.warn(`Partial success (${downloadMode}): ${succeededImages} succeeded, ${failedImages} failed`)
      return {
        status: 'partial_success',
        errorMessage: `${failedImages}/${totalImages} images failed`,
        imagesFailed: failedImages,
      }
    }

    return {
      status: 'failed',
      errorMessage: `All images failed (${failedImages}/${totalImages})`,
      imagesFailed: failedImages,
    }
  }

  return { status: 'completed' }
}

export async function processNoneFormatChapter(
  runtime: ChapterProcessingRuntime,
  input: {
    opts: ProcessChapterStreamingOptions & { format: 'none' }
    urls: string[]
    integrationId: string
    downloadImage: ChapterDownloadImageFn
    normalizeSettings: ArchiveNormalizationSettings
  },
): Promise<ChapterOutcome> {
  const { opts, urls, integrationId, downloadImage, normalizeSettings } = input
  const {
    taskId,
    chapter,
    seriesTitle,
    includeComicInfo,
    downloadMode,
    comicInfoVersion,
    onProgress,
    onArchiveProgress,
    abortSignal,
    coverImage,
    seriesMetadata,
  } = opts
  const images: DownloadedChapterImage[] = []
  const { total, failed } = await downloadChapterImages(runtime, {
    urls,
    integrationId,
    chapterId: chapter.id,
    integrationContext: opts.integrationContext,
    abortSignal,
    onProgress,
    onImageDownloaded: opts.onImageDownloaded,
    downloadImage,
    onDownloaded: ({ index, result }) => {
      images.push({
        index,
        filename: sanitizeFilename(result.filename),
        data: result.data,
        mimeType: result.mimeType,
      })
    },
    onDownloadFailed: ({ url, error }) => {
      logger.warn(`⚠️ Image download failed (skipped): ${url}`, error)
    },
  })

  images.sort((a, b) => a.index - b.index)

  const chapterDir = chapter.resolvedPath || sanitizeFilename(chapter.title)
  if (downloadMode === 'custom') {
    let writeStarted = false
    try {
      const dir = await runtime.resolveWritableDownloadRoot({
        taskId,
        chapter,
        totalImages: total,
      })
      if (dir) {
        if (coverImage) {
          const coverPath = `${chapterDir}/${buildCoverOutputFilename(coverImage.mimeType)}`
          writeStarted = true
          logger.debug('Writing cover image to custom folder for NONE format', { chapterDir, coverPath })
          await writeBlobToPath(dir, coverPath, new Blob([coverImage.data], { type: coverImage.mimeType || 'application/octet-stream' }), true)
        }

        for (const image of images) {
          const filename = buildImageOutputFilename({
            index: image.index,
            totalImages: total,
            originalFilename: image.filename,
            mimeType: image.mimeType,
            normalizeImageFilenames: normalizeSettings.normalizeImageFilenames,
            imagePaddingDigits: normalizeSettings.imagePaddingDigits,
          })
          const filePath = `${chapterDir}/${filename}`
          writeStarted = true
          await writeBlobToPath(dir, filePath, new Blob([image.data], { type: image.mimeType || 'application/octet-stream' }), true)
        }

        if (includeComicInfo) {
          const comicInfoXml = buildOptionalComicInfoXml({
            includeComicInfo,
            chapter,
            seriesTitle,
            seriesMetadata,
            pageCount: images.length + (coverImage ? 1 : 0),
            comicInfoVersion,
            hasCoverImage: !!coverImage,
          })
          if (comicInfoXml) {
            const comicInfoPath = `${chapterDir}/ComicInfo.xml`
            writeStarted = true
            await writeBlobToPath(dir, comicInfoPath, new Blob([comicInfoXml], { type: 'application/xml' }), true)
          }
        }

        await onArchiveProgress(100, 'saved')
        return createNoneFormatChapterOutcome({
          downloadMode: 'custom',
          totalImages: total,
          failedImages: failed,
        })
      }
    } catch (error) {
      await runtime.emitFsaFallbackProgress(taskId, chapter, total)
      if (writeStarted) {
        await onProgress(0, 'Retrying with browser downloads')
        logger.warn('Custom folder write failed mid-download. Reprocessing chapter with browser downloads.', error)
        return runtime.retryWithBrowserDownloads({
          ...opts,
          downloadMode: 'browser',
        })
      }
      logger.debug('custom folder write failed; fallback to browser', error)
    }
  }

  if (coverImage) {
    const coverPath = `${chapterDir}/${buildCoverOutputFilename(coverImage.mimeType)}`.replace(/\\/g, '/')
    const coverBlob = new Blob([coverImage.data], { type: coverImage.mimeType || 'application/octet-stream' })
    logger.debug('Requesting browser download for NONE-format cover image', { chapterDir, coverPath })
    const coverResp = await runtime.requestBrowserBlobDownload({
      taskId,
      chapterId: chapter.id,
      blob: coverBlob,
      filename: coverPath,
    })
    if (!coverResp || coverResp.success !== true) {
      logger.debug('cover image download request failed', coverResp)
    }
  }

  for (const image of images) {
    const filename = buildImageOutputFilename({
      index: image.index,
      totalImages: total,
      originalFilename: image.filename,
      mimeType: image.mimeType,
      normalizeImageFilenames: normalizeSettings.normalizeImageFilenames,
      imagePaddingDigits: normalizeSettings.imagePaddingDigits,
    })
    const filePath = `${chapterDir}/${filename}`.replace(/\\/g, '/')
    const blob = new Blob([image.data], { type: image.mimeType || 'application/octet-stream' })
    const response = await runtime.requestBrowserBlobDownload({
      taskId,
      chapterId: chapter.id,
      blob,
      filename: filePath,
    })
    if (!response || response.success !== true) {
      logger.debug('image download request failed', response)
    }
  }

  if (includeComicInfo) {
    const comicInfoXml = buildOptionalComicInfoXml({
      includeComicInfo,
      chapter,
      seriesTitle,
      seriesMetadata,
      pageCount: images.length + (coverImage ? 1 : 0),
      comicInfoVersion,
      hasCoverImage: !!coverImage,
    })
    if (comicInfoXml) {
      const comicInfoPath = `${chapterDir}/ComicInfo.xml`.replace(/\\/g, '/')
      const comicInfoBlob = new Blob([comicInfoXml], { type: 'application/xml' })
      const comicInfoResp = await runtime.requestBrowserBlobDownload({
        taskId,
        chapterId: chapter.id,
        blob: comicInfoBlob,
        filename: comicInfoPath,
      })
      if (!comicInfoResp || comicInfoResp.success !== true) {
        logger.debug('ComicInfo.xml download request failed', comicInfoResp)
      }
    }
  }

  await onArchiveProgress(100, 'download started')
  return createNoneFormatChapterOutcome({
    downloadMode: 'browser',
    totalImages: total,
    failedImages: failed,
  })
}

export async function processArchiveFormatChapter(
  runtime: ChapterProcessingRuntime,
  input: {
    opts: ProcessChapterStreamingOptions & { format: 'cbz' | 'zip' }
    urls: string[]
    integrationId: string
    downloadImage: ChapterDownloadImageFn
    normalizeSettings: ArchiveNormalizationSettings
  },
): Promise<ChapterOutcome> {
  const { opts, urls, integrationId, downloadImage, normalizeSettings } = input
  const {
    taskId,
    chapter,
    seriesTitle,
    format,
    includeComicInfo,
    downloadMode,
    comicInfoVersion,
    onProgress,
    onArchiveProgress,
    abortSignal,
    coverImage,
    seriesMetadata,
  } = opts

  await onArchiveProgress(5, 'starting archive')
  const { worker, resultPromise } = createArchiveWorker()
  const archivePageCount = urls.length + (coverImage ? 1 : 0)

  initializeArchiveWorker({
    worker,
    chapter,
    format,
    normalizeSettings,
    totalImages: archivePageCount,
  })
  addComicInfoToArchiveWorker({
    worker,
    includeComicInfo,
    chapter,
    seriesTitle,
    seriesMetadata,
    pageCount: archivePageCount,
    comicInfoVersion,
    hasCoverImage: !!coverImage,
  })
  addCoverToArchiveWorker(worker, coverImage)

  const { total, succeeded, failed, failedUrls, failedReasons } = await downloadChapterImages(runtime, {
    urls,
    integrationId,
    chapterId: chapter.id,
    integrationContext: opts.integrationContext,
    abortSignal,
    onProgress,
    onImageDownloaded: opts.onImageDownloaded,
    downloadImage,
    mapImageIndex: (index) => index + (coverImage ? 1 : 0),
    collectFailureReasons: true,
    onDownloaded: ({ index, result }) => {
      const filename = sanitizeFilename(result.filename)
      const buffer = result.data
      worker.postMessage({
        type: 'addImage',
        filename,
        buffer,
        index,
        mimeType: result.mimeType,
      }, [buffer])
    },
    onDownloadFailed: ({ url, error, failedCount, total: totalImages }) => {
      logger.warn(`⚠️ Image download failed (${failedCount}/${totalImages}): ${url}`, error)
    },
  })

  await onArchiveProgress(90, 'finalizing')
  if (abortSignal?.aborted) throw new Error('job-cancelled')

  if (failed > 0) {
    logger.warn(`📦 Finalizing archive: ${succeeded}/${total} images succeeded, ${failed} failed`)
    if (failedUrls.length > 0) {
      logger.warn(`⚠️ Some images failed to download: ${failedUrls.length}/${total}`)
      logger.warn('   First 10 failed URLs:', failedUrls.slice(0, 10))
    }
  } else {
    logger.debug(`📦 Finalizing archive: ${succeeded}/${total} images downloaded successfully`)
  }

  if (failed > 0) {
    const reasonSummary = failedReasons.length > 0
      ? ` reasons: ${failedReasons.join(' | ')}`
      : ''
    const errorMsg = `Image download failed: ${failed}/${total} images could not be downloaded${reasonSummary} (${failedUrls.slice(0, 3).join(', ')}${failed > 3 ? '...' : ''})`
    logger.error('❌ Chapter failed due to image failure(s) - discarding partial archive')
    logger.error(`   Chapter: ${chapter.title}`)
    logger.error(`   Format: ${format} (archive format - partial archives not allowed)`)
    logger.error(`   ${succeeded}/${total} succeeded, ${failed} failed`)
    return { status: 'failed', errorMessage: errorMsg, imagesFailed: failed }
  }

  worker.postMessage({ type: 'finalize' })
  const result = await resultPromise
  if (!result?.success || !result.buffer) {
    const errorMsg = result?.error || 'Archive creation failed'
    logger.error(`❌ Archive creation failed: ${errorMsg}`)
    logger.error(`   Chapter: ${chapter.title}`)
    logger.error(`   Images: ${succeeded}/${total} succeeded, ${failed} failed`)
    logger.error(`   Format: ${format}`)

    const memStats = runtime.getMemoryStats()
    if (memStats) {
      logger.error(`   Memory at failure: ${memStats.usedMB.toFixed(1)}MB / ${memStats.totalMB.toFixed(1)}MB`)
    }

    throw new Error(`Archive creation failed: ${errorMsg} (${succeeded}/${total} images, ${failed} failed)`)
  }

  await onArchiveProgress(95, 'preparing download')

  const mimeType = format === 'cbz' ? 'application/x-cbz' : 'application/zip'
  const blob = new Blob([result.buffer], { type: mimeType })
  const finalPath = chapter.resolvedPath || `${sanitizeFilename(chapter.title)}.${format}`
  logger.debug(`[Archive Download] format=${format}, finalPath=${finalPath}`)

  if (downloadMode === 'custom') {
    let writeStarted = false
    try {
      const dir = await runtime.resolveWritableDownloadRoot({
        taskId,
        chapter,
        totalImages: total,
      })
      if (dir) {
        writeStarted = true
        await writeBlobToPath(dir, finalPath, blob, true)
        await onArchiveProgress(100, 'saved')
        return { status: 'completed' }
      }
    } catch (error) {
      await runtime.emitFsaFallbackProgress(taskId, chapter, total)
      if (writeStarted) {
        await onProgress(0, 'Retrying with browser downloads')
        logger.warn('Custom folder archive write failed mid-download. Reprocessing chapter with browser downloads.', error)
        return runtime.retryWithBrowserDownloads({
          ...opts,
          downloadMode: 'browser',
        })
      }
      logger.debug('custom folder write failed; will fallback to browser downloads', error)
    }
  }

  const normalized = normalizeDownloadPath(finalPath)
  const response = await runtime.requestBrowserBlobDownload({
    taskId,
    chapterId: chapter.id,
    blob,
    filename: normalized,
  })
  if (!response || response.success !== true) {
    const errorMessage = response && 'error' in response ? response.error : 'background downloads.download failed'
    throw new Error(errorMessage)
  }

  await onArchiveProgress(100, 'download started')
  return { status: 'completed' }
}
