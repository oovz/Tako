import type { Chapter } from "@/src/types/chapter"
import logger from "@/src/runtime/logger"
import { sanitizeFilename } from "@/src/shared/filename-sanitizer"
import {
  writeBlobToPath,
  type WriteBlobToPathResult,
} from "@/src/storage/fs-access"
import createZipArchiveWorker from "./archive-worker-factory"
import { downloadChapterImages } from "./chapter-image-downloads"
import {
  buildCoverOutputFilename,
  buildImageOutputFilename,
  buildOptionalComicInfoXml,
  normalizeDownloadPath,
} from "./chapter-processing-helpers"
import { ZIP_WORKER_FINALIZATION_TIMEOUT_MS } from "@/src/constants/timeouts"
import type {
  ArchiveNormalizationSettings,
  ChapterDownloadImageFn,
  ChapterOutcome,
  ChapterProcessingRuntime,
  ProcessChapterStreamingOptions,
  WorkerZipProgress,
  WorkerZipResult,
} from "./chapter-processing-types"
import type { SeriesMetadataInput } from "./helpers"
import { FsaWriteError, toFsaWriteError } from "./error-categories"

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
  WorkerZipProgress,
  WorkerZipResult,
} from "./chapter-processing-types"

function isWorkerZipProgress(
  value: WorkerZipResult | WorkerZipProgress
): value is WorkerZipProgress {
  return (
    !!value &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "progress"
  )
}

function createArchiveWorker(
  onProgress?: (progress: WorkerZipProgress) => void | Promise<void>
): {
  worker: Worker
  resultPromise: Promise<WorkerZipResult>
  startFinalizationTimeout: () => void
  clearResultTimeout: () => void
  rejectResult: (error: unknown) => void
} {
  const worker = createZipArchiveWorker()

  let resolveResult!: (value: WorkerZipResult) => void
  let rejectResult!: (error: unknown) => void
  const resultPromise = new Promise<WorkerZipResult>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })

  let timeout: ReturnType<typeof setTimeout> | undefined
  const clearResultTimeout = () => {
    if (timeout) {
      clearTimeout(timeout)
      timeout = undefined
    }
  }
  const startFinalizationTimeout = () => {
    clearResultTimeout()
    timeout = setTimeout(() => {
      try {
        worker.terminate()
      } catch (error) {
        logger.debug("zip worker terminate failed (non-fatal)", error)
      }
      rejectResult(new Error("Zip worker timed out"))
    }, ZIP_WORKER_FINALIZATION_TIMEOUT_MS)
  }

  worker.onmessage = (
    event: MessageEvent<WorkerZipResult | WorkerZipProgress>
  ) => {
    if (isWorkerZipProgress(event.data)) {
      startFinalizationTimeout()
      if (onProgress) {
        void Promise.resolve(onProgress(event.data)).catch((error) => {
          logger.debug("zip worker progress handling failed (non-fatal)", error)
        })
      }
      return
    }

    clearResultTimeout()
    resolveResult(event.data)
  }
  worker.onerror = (event) => {
    clearResultTimeout()
    const workerError =
      event.error instanceof Error
        ? event.error
        : new Error(
            event.message
              ? `Zip worker error: ${event.message}${event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : ""}`
              : "Zip worker error"
          )
    rejectResult(workerError)
  }

  return {
    worker,
    resultPromise,
    startFinalizationTimeout,
    clearResultTimeout,
    rejectResult,
  }
}

function initializeArchiveWorker(input: {
  worker: Worker
  chapter: Chapter
  format: "cbz" | "zip"
  normalizeSettings: ArchiveNormalizationSettings
  totalImages: number
}): void {
  const { worker, chapter, format, normalizeSettings, totalImages } = input
  worker.postMessage({
    type: "init",
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
  comicInfoVersion: "2.0"
  hasCoverImage: boolean
}): void {
  const {
    worker,
    includeComicInfo,
    chapter,
    seriesTitle,
    seriesMetadata,
    pageCount,
    comicInfoVersion,
    hasCoverImage,
  } = input
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

  worker.postMessage({ type: "addComicInfo", xml })
  logger.debug(
    `📋 Added ComicInfo.xml as first entry (${pageCount} pages estimated)`
  )
}

function addCoverToArchiveWorker(
  worker: Worker,
  coverImage?: { data: ArrayBuffer; mimeType: string }
): void {
  if (!coverImage) {
    return
  }

  const coverBuffer = coverImage.data.slice(0)
  worker.postMessage(
    {
      type: "addImage",
      filename: buildCoverOutputFilename(coverImage.mimeType),
      buffer: coverBuffer,
      index: 0,
      mimeType: coverImage.mimeType,
    },
    [coverBuffer]
  )
}

function createNoneFormatChapterOutcome(input: {
  downloadMode: "browser" | "custom"
  totalImages: number
  failedImages: number
  totalAdditionalOutputs?: number
  failedAdditionalOutputs?: number
}): ChapterOutcome {
  const {
    downloadMode,
    totalImages,
    failedImages,
    totalAdditionalOutputs = 0,
    failedAdditionalOutputs = 0,
  } = input
  const totalOutputs = totalImages + totalAdditionalOutputs
  const failedOutputs = failedImages + failedAdditionalOutputs

  if (failedOutputs > 0) {
    const succeededOutputs = totalOutputs - failedOutputs
    if (succeededOutputs > 0) {
      logger.warn(
        `Partial success (${downloadMode}): ${succeededOutputs} succeeded, ${failedOutputs} failed`
      )
      return {
        status: "partial_success",
        errorMessage:
          totalAdditionalOutputs > 0
            ? `${failedOutputs}/${totalOutputs} output files failed`
            : `${failedImages}/${totalImages} images failed`,
        imagesFailed: failedImages || undefined,
        outputsRequested: totalOutputs,
        outputsFailedBeforeHandoff:
          downloadMode === "browser" ? failedOutputs : 0,
        outputsCommitted: downloadMode === "custom" ? succeededOutputs : 0,
      }
    }

    return {
      status: "failed",
      errorMessage:
        totalAdditionalOutputs > 0
          ? `All output files failed (${failedOutputs}/${totalOutputs})`
          : `All images failed (${failedImages}/${totalImages})`,
      imagesFailed: failedImages || undefined,
      outputsRequested: totalOutputs,
      outputsFailedBeforeHandoff:
        downloadMode === "browser" ? failedOutputs : 0,
      outputsCommitted: 0,
    }
  }

  return {
    status: "completed",
    outputsRequested: totalOutputs,
    outputsFailedBeforeHandoff: 0,
    outputsCommitted: downloadMode === "custom" ? totalOutputs : 0,
  }
}

function createFsaDestinationFailureOutcome(input: {
  error: FsaWriteError
  outputsRequested: number
  outputsCommitted: number
  totalImages: number
  committedImages: number
}): ChapterOutcome {
  const imagesFailed = Math.max(0, input.totalImages - input.committedImages)
  return {
    status: input.outputsCommitted > 0 ? "partial_success" : "failed",
    errorMessage: input.error.message,
    errorCategory: input.error.category,
    imagesFailed: imagesFailed || undefined,
    outputsRequested: input.outputsRequested,
    outputsFailedBeforeHandoff: 0,
    outputsCommitted: input.outputsCommitted,
  }
}

type ConflictPolicy = "uniquify" | "overwrite"

function getConflictPolicy(
  opts: ProcessChapterStreamingOptions
): ConflictPolicy {
  return opts.settingsSnapshot.conflictPolicy
}

async function writeFsaOutput(input: {
  dir: FileSystemDirectoryHandle
  path: string
  blob: Blob
  collisionPolicy: ConflictPolicy
  signal?: AbortSignal
  onBytesWritten?: (bytesWritten: number) => void | Promise<void>
}): Promise<WriteBlobToPathResult> {
  try {
    return await writeBlobToPath(
      input.dir,
      input.path,
      input.blob,
      input.collisionPolicy,
      {
        signal: input.signal,
        onBytesWritten: input.onBytesWritten,
      }
    )
  } catch (error) {
    if (input.signal?.aborted) throw error
    throw toFsaWriteError(error)
  }
}

export async function processNoneFormatChapter(
  runtime: ChapterProcessingRuntime,
  input: {
    opts: ProcessChapterStreamingOptions & { format: "none" }
    urls: string[]
    integrationId: string
    downloadImage: ChapterDownloadImageFn
    normalizeSettings: ArchiveNormalizationSettings
  }
): Promise<ChapterOutcome> {
  const { opts, urls, integrationId, downloadImage, normalizeSettings } = input
  const {
    taskId,
    jobId,
    attempt,
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
  const chapterDir = chapter.resolvedPath || sanitizeFilename(chapter.title)
  const total = urls.length
  const outputCount = total + (coverImage ? 1 : 0) + (includeComicInfo ? 1 : 0)
  const collisionPolicy = getConflictPolicy(opts)
  let writableRoot: FileSystemDirectoryHandle | null = null
  let committedFsaOutputs = 0
  let committedFsaImages = 0
  let fsaWriteFailure: FsaWriteError | null = null

  if (downloadMode === "custom") {
    try {
      writableRoot = await runtime.resolveWritableDownloadRoot({
        taskId,
        chapter,
        totalImages: total,
      })
    } catch (error) {
      if (abortSignal?.aborted) {
        throw new Error("job-cancelled", { cause: error })
      }
      throw error
    }
  }

  if (abortSignal?.aborted) throw new Error("job-cancelled")

  let failedPageHandoffs = 0
  let failedAdditionalHandoffs = 0
  let totalAdditionalOutputs = 0

  if (coverImage) {
    totalAdditionalOutputs++
    const coverPath =
      `${chapterDir}/${buildCoverOutputFilename(coverImage.mimeType)}`.replace(
        /\\/g,
        "/"
      )
    const coverBlob = new Blob([coverImage.data], {
      type: coverImage.mimeType || "application/octet-stream",
    })
    try {
      if (writableRoot) {
        await onArchiveProgress(92, "saving cover")
        await writeFsaOutput({
          dir: writableRoot,
          path: coverPath,
          blob: coverBlob,
          collisionPolicy,
          signal: abortSignal,
          onBytesWritten: () => onArchiveProgress(92, "saving cover"),
        })
        committedFsaOutputs++
      } else {
        await onArchiveProgress(92, "download handoff")
        const coverResp = await runtime.requestBrowserBlobDownload({
          jobId,
          attempt,
          outputId: `${jobId}:image:cover`,
          taskId,
          chapterId: chapter.id,
          blob: coverBlob,
          filename: coverPath,
          outputIndex: 0,
          outputCount,
          outputKind: "image",
          signal: abortSignal,
        })
        if (!coverResp || coverResp.success !== true) {
          failedAdditionalHandoffs++
          logger.debug("cover image download request failed", coverResp)
        }
      }
    } catch (error) {
      if (abortSignal?.aborted) {
        throw new Error("job-cancelled", { cause: error })
      }
      if (!writableRoot) throw error
      fsaWriteFailure = toFsaWriteError(error)
      return createFsaDestinationFailureOutcome({
        error: fsaWriteFailure,
        outputsRequested: outputCount,
        outputsCommitted: committedFsaOutputs,
        totalImages: total,
        committedImages: committedFsaImages,
      })
    }
  }

  const { succeeded, failed } = await downloadChapterImages(runtime, {
    urls,
    integrationId,
    chapterId: chapter.id,
    integrationContext: opts.integrationContext,
    rateLimitSettings: opts.settingsSnapshot.rateLimitSettings,
    abortSignal,
    onProgress,
    onImageDownloaded: opts.onImageDownloaded,
    downloadImage,
    onDownloaded: async ({ index, result }) => {
      if (abortSignal?.aborted) throw new Error("job-cancelled")
      const filename = buildImageOutputFilename({
        index,
        totalImages: total,
        originalFilename: sanitizeFilename(result.filename),
        mimeType: result.mimeType,
        normalizeImageFilenames: normalizeSettings.normalizeImageFilenames,
        imagePaddingDigits: normalizeSettings.imagePaddingDigits,
      })
      const filePath = `${chapterDir}/${filename}`.replace(/\\/g, "/")
      const blob = new Blob([result.data], {
        type: result.mimeType || "application/octet-stream",
      })

      if (writableRoot) {
        if (fsaWriteFailure) throw fsaWriteFailure
        await onArchiveProgress(95, "saving images")
        try {
          await writeFsaOutput({
            dir: writableRoot,
            path: filePath,
            blob,
            collisionPolicy,
            signal: abortSignal,
            onBytesWritten: () => onArchiveProgress(95, "saving images"),
          })
          committedFsaOutputs++
          committedFsaImages++
        } catch (error) {
          if (abortSignal?.aborted) throw error
          fsaWriteFailure ??= toFsaWriteError(error)
          throw fsaWriteFailure
        }
        return
      }

      await onArchiveProgress(95, "download handoff")
      const response = await runtime.requestBrowserBlobDownload({
        jobId,
        attempt,
        outputId: `${jobId}:image:${index}`,
        taskId,
        chapterId: chapter.id,
        blob,
        filename: filePath,
        outputIndex: (coverImage ? 1 : 0) + index,
        outputCount,
        outputKind: "image",
        signal: abortSignal,
      })
      if (!response || response.success !== true) {
        failedPageHandoffs++
        logger.debug("image download request failed", response)
      }
    },
    onDownloadFailed: ({ url, error }) => {
      logger.warn(`⚠️ Image download failed (skipped): ${url}`, error)
    },
    isFatalError: (error) => error instanceof FsaWriteError,
  })

  if (abortSignal?.aborted) throw new Error("job-cancelled")
  if (fsaWriteFailure) {
    return createFsaDestinationFailureOutcome({
      error: fsaWriteFailure,
      outputsRequested: outputCount,
      outputsCommitted: committedFsaOutputs,
      totalImages: total,
      committedImages: committedFsaImages,
    })
  }

  if (includeComicInfo) {
    if (abortSignal?.aborted) throw new Error("job-cancelled")
    const comicInfoXml = buildOptionalComicInfoXml({
      includeComicInfo,
      chapter,
      seriesTitle,
      seriesMetadata,
      pageCount: succeeded + (coverImage ? 1 : 0),
      comicInfoVersion,
      hasCoverImage: !!coverImage,
    })
    if (comicInfoXml) {
      totalAdditionalOutputs++
      const comicInfoPath = `${chapterDir}/ComicInfo.xml`.replace(/\\/g, "/")
      const comicInfoBlob = new Blob([comicInfoXml], {
        type: "application/xml",
      })
      if (writableRoot) {
        try {
          await onArchiveProgress(98, "saving metadata")
          await writeFsaOutput({
            dir: writableRoot,
            path: comicInfoPath,
            blob: comicInfoBlob,
            collisionPolicy,
            signal: abortSignal,
            onBytesWritten: () => onArchiveProgress(98, "saving metadata"),
          })
          committedFsaOutputs++
        } catch (error) {
          if (abortSignal?.aborted) {
            throw new Error("job-cancelled", { cause: error })
          }
          fsaWriteFailure = toFsaWriteError(error)
          return createFsaDestinationFailureOutcome({
            error: fsaWriteFailure,
            outputsRequested: outputCount,
            outputsCommitted: committedFsaOutputs,
            totalImages: total,
            committedImages: committedFsaImages,
          })
        }
      } else {
        await onArchiveProgress(98, "download handoff")
        const comicInfoResp = await runtime.requestBrowserBlobDownload({
          jobId,
          attempt,
          outputId: `${jobId}:image:comic-info`,
          taskId,
          chapterId: chapter.id,
          blob: comicInfoBlob,
          filename: comicInfoPath,
          outputIndex: (coverImage ? 1 : 0) + total,
          outputCount,
          outputKind: "image",
          signal: abortSignal,
        })
        if (!comicInfoResp || comicInfoResp.success !== true) {
          failedAdditionalHandoffs++
          logger.debug("ComicInfo.xml download request failed", comicInfoResp)
        }
      }
    }
  }

  await onArchiveProgress(100, writableRoot ? "saved" : "download started")
  return createNoneFormatChapterOutcome({
    downloadMode: writableRoot ? "custom" : "browser",
    totalImages: total,
    failedImages: failed + failedPageHandoffs,
    totalAdditionalOutputs,
    failedAdditionalOutputs: failedAdditionalHandoffs,
  })
}

export async function processArchiveFormatChapter(
  runtime: ChapterProcessingRuntime,
  input: {
    opts: ProcessChapterStreamingOptions & { format: "cbz" | "zip" }
    urls: string[]
    integrationId: string
    downloadImage: ChapterDownloadImageFn
    normalizeSettings: ArchiveNormalizationSettings
  }
): Promise<ChapterOutcome> {
  const { opts, urls, integrationId, downloadImage, normalizeSettings } = input
  const {
    taskId,
    jobId,
    attempt,
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

  const finalPath =
    chapter.resolvedPath || `${sanitizeFilename(chapter.title)}.${format}`
  let writableRoot: FileSystemDirectoryHandle | null = null
  if (downloadMode === "custom") {
    try {
      writableRoot = await runtime.resolveWritableDownloadRoot({
        taskId,
        chapter,
        totalImages: urls.length,
      })
    } catch (error) {
      if (abortSignal?.aborted) {
        throw new Error("job-cancelled", { cause: error })
      }
      throw error
    }
  }

  const {
    worker,
    resultPromise,
    startFinalizationTimeout,
    clearResultTimeout,
    rejectResult,
  } = createArchiveWorker()
  const archivePageCount = urls.length + (coverImage ? 1 : 0)

  const onAbort = () => {
    clearResultTimeout()
    try {
      worker.terminate()
    } catch (error) {
      logger.debug("zip worker terminate failed (non-fatal)", error)
    }
    rejectResult(new Error("job-cancelled"))
  }
  abortSignal?.addEventListener("abort", onAbort, { once: true })

  try {
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

    const { total, succeeded, failed, failedUrls, failedReasons } =
      await downloadChapterImages(runtime, {
        urls,
        integrationId,
        chapterId: chapter.id,
        integrationContext: opts.integrationContext,
        rateLimitSettings: opts.settingsSnapshot.rateLimitSettings,
        abortSignal,
        onProgress,
        onImageDownloaded: opts.onImageDownloaded,
        downloadImage,
        mapImageIndex: (index) => index + (coverImage ? 1 : 0),
        collectFailureReasons: true,
        onDownloaded: ({ index, result }) => {
          const filename = sanitizeFilename(result.filename)
          const buffer = result.data
          worker.postMessage(
            {
              type: "addImage",
              filename,
              buffer,
              index,
              mimeType: result.mimeType,
            },
            [buffer]
          )
        },
        onDownloadFailed: ({ url, error, failedCount, total: totalImages }) => {
          logger.warn(
            `⚠️ Image download failed (${failedCount}/${totalImages}): ${url}`,
            error
          )
        },
      })

    await onArchiveProgress(90, "finalizing")
    if (abortSignal?.aborted) throw new Error("job-cancelled")

    if (failed > 0) {
      logger.warn(
        `📦 Finalizing archive: ${succeeded}/${total} images succeeded, ${failed} failed`
      )
      if (failedUrls.length > 0) {
        logger.warn(
          `⚠️ Some images failed to download: ${failedUrls.length}/${total}`
        )
        logger.warn("   First 10 failed URLs:", failedUrls.slice(0, 10))
      }
    } else {
      logger.debug(
        `📦 Finalizing archive: ${succeeded}/${total} images downloaded successfully`
      )
    }

    if (failed > 0) {
      const reasonSummary =
        failedReasons.length > 0 ? ` reasons: ${failedReasons.join(" | ")}` : ""
      const errorMsg = `Image download failed: ${failed}/${total} images could not be downloaded${reasonSummary} (${failedUrls.slice(0, 3).join(", ")}${failed > 3 ? "..." : ""})`
      logger.error(
        "❌ Chapter failed due to image failure(s) - discarding partial archive"
      )
      logger.error(`   Chapter: ${chapter.title}`)
      logger.error(
        `   Format: ${format} (archive format - partial archives not allowed)`
      )
      logger.error(`   ${succeeded}/${total} succeeded, ${failed} failed`)
      return { status: "failed", errorMessage: errorMsg, imagesFailed: failed }
    }

    startFinalizationTimeout()
    worker.postMessage({ type: "finalize" })
    const result = await resultPromise
    if (!result?.success || !result.buffer) {
      const errorMsg = result?.error || "Archive creation failed"
      logger.error(`❌ Archive creation failed: ${errorMsg}`)
      logger.error(`   Chapter: ${chapter.title}`)
      logger.error(
        `   Images: ${succeeded}/${total} succeeded, ${failed} failed`
      )
      logger.error(`   Format: ${format}`)

      const memStats = runtime.getMemoryStats()
      if (memStats) {
        logger.error(
          `   Memory at failure: ${memStats.usedMB.toFixed(1)}MB / ${memStats.totalMB.toFixed(1)}MB`
        )
      }

      throw new Error(
        `Archive creation failed: ${errorMsg} (${succeeded}/${total} images, ${failed} failed)`
      )
    }

    await onArchiveProgress(95, "preparing download")

    const mimeType = format === "cbz" ? "application/x-cbz" : "application/zip"
    const blob = new Blob([result.buffer], { type: mimeType })
    logger.debug(`[Archive Download] format=${format}, finalPath=${finalPath}`)

    if (writableRoot) {
      try {
        await onArchiveProgress(96, "saving")
        await writeFsaOutput({
          dir: writableRoot,
          path: finalPath,
          blob,
          collisionPolicy: getConflictPolicy(opts),
          signal: abortSignal,
          onBytesWritten: () => onArchiveProgress(96, "saving"),
        })
        await onArchiveProgress(100, "saved")
        return {
          status: "completed",
          outputsRequested: 1,
          outputsFailedBeforeHandoff: 0,
          outputsCommitted: 1,
        }
      } catch (error) {
        if (abortSignal?.aborted) {
          throw new Error("job-cancelled", { cause: error })
        }
        throw error
      }
    }

    const normalized = normalizeDownloadPath(finalPath)
    await onArchiveProgress(96, "download handoff")
    if (abortSignal?.aborted) throw new Error("job-cancelled")
    const response = await runtime.requestBrowserBlobDownload({
      jobId,
      attempt,
      outputId: `${jobId}:archive:0`,
      taskId,
      chapterId: chapter.id,
      blob,
      filename: normalized,
      outputIndex: 0,
      outputCount: 1,
      outputKind: "archive",
      signal: abortSignal,
    })
    if (!response || response.success !== true) {
      const errorMessage =
        response && "error" in response
          ? response.error
          : "background downloads.download failed"
      throw new Error(errorMessage)
    }

    await onArchiveProgress(100, "download started")
    return {
      status: "completed",
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 0,
    }
  } finally {
    abortSignal?.removeEventListener("abort", onAbort)
    try {
      worker.terminate()
    } catch (error) {
      logger.debug("zip worker terminate failed (non-fatal)", error)
    }
  }
}
