import logger from "@/src/runtime/logger"
import { sanitizeFilename } from "@/src/shared/filename-sanitizer"
import createZipArchiveWorker from "./archive-worker-factory"
import { ArchiveWorkerSession } from "./archive-worker-session"
import {
  ChapterResourceLimitError,
  downloadChapterImages,
} from "./chapter-image-downloads"
import {
  buildCoverOutputFilename,
  buildImageOutputFilename,
  buildOptionalComicInfoXml,
  normalizeDownloadPath,
} from "./chapter-processing-helpers"
import {
  MAX_ARCHIVE_BYTES,
  MAX_METADATA_RESPONSE_BYTES,
} from "@/src/constants/timeouts"
import type { OffscreenLiveResourceLease } from "@/src/runtime/offscreen-live-resource-ledger"
import type {
  ArchiveNormalizationSettings,
  ChapterDownloadImageFn,
  ChapterOutcome,
  ChapterProcessingRuntime,
  ProcessChapterStreamingOptions,
} from "./chapter-processing-types"
import { FsaWriteError, toFsaWriteError } from "./error-categories"
import {
  requireNativeOutputDisposition,
  createNoneFormatChapterOutcome,
  createFsaDestinationFailureOutcome,
} from "./chapter-processing-outcomes"
import {
  getConflictPolicy,
  writeFsaOutput,
  resolveChapterWritableRoot,
} from "./chapter-processing-fsa"
import {
  assertChapterImageCount,
  initializeArchiveWorker,
  addComicInfoToArchiveWorker,
  addCoverToArchiveWorker,
} from "./chapter-archive-worker-helpers"
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
  assertChapterImageCount(urls.length + (coverImage ? 1 : 0))
  const chapterDir = chapter.resolvedPath || sanitizeFilename(chapter.title)
  const total = urls.length
  const comicInfoXml = includeComicInfo
    ? buildOptionalComicInfoXml({
        includeComicInfo,
        chapter,
        seriesTitle,
        seriesMetadata,
        pageCount: total + (coverImage ? 1 : 0),
        comicInfoVersion,
        hasCoverImage: !!coverImage,
      })
    : null
  const outputCount =
    total + (coverImage ? 1 : 0) + (comicInfoXml === null ? 0 : 1)
  const collisionPolicy = getConflictPolicy(opts)
  let writableRoot: FileSystemDirectoryHandle | null = null
  let committedFsaOutputs = 0
  let committedFsaImages = 0
  let fsaWriteFailure: FsaWriteError | null = null

  if (downloadMode === "custom") {
    writableRoot = await resolveChapterWritableRoot(runtime, {
      taskId,
      chapter,
      totalImages: total,
      abortSignal,
    })
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
    const coverBlobLease = runtime.liveResourceLedger.reserve(
      coverImage.data.byteLength,
      "none-format cover Blob"
    )
    try {
      const coverBlob = new Blob([coverImage.data], {
        type: coverImage.mimeType || "application/octet-stream",
      })
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
          resourceLease: coverBlobLease,
          filename: coverPath,
          outputIndex: 0,
          outputCount,
          outputKind: "image",
          signal: abortSignal,
        })
        if (
          requireNativeOutputDisposition(coverResp).disposition ===
          "not_persisted"
        ) {
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
    } finally {
      coverBlobLease.release()
    }
  }

  const { failed } = await downloadChapterImages(runtime, {
    urls,
    integrationId,
    chapterId: chapter.id,
    integrationContext: opts.integrationContext,
    rateLimitSettings: opts.settingsSnapshot.rateLimitSettings,
    rateLimitService: runtime.rateLimitService,
    abortSignal,
    onProgress,
    onImageDownloaded: opts.onImageDownloaded,
    downloadImage,
    initialAggregateBytes: coverImage?.data.byteLength ?? 0,
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
      const blobLease = runtime.liveResourceLedger.reserve(
        result.data.byteLength,
        "none-format image Blob"
      )
      try {
        const blob = new Blob([result.data], {
          type: result.mimeType || "application/octet-stream",
        })

        if (writableRoot) {
          if (fsaWriteFailure) throw fsaWriteFailure
          await onArchiveProgress(95, "saving images")
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
          resourceLease: blobLease,
          filename: filePath,
          outputIndex: (coverImage ? 1 : 0) + index,
          outputCount,
          outputKind: "image",
          signal: abortSignal,
        })
        if (
          requireNativeOutputDisposition(response).disposition ===
          "not_persisted"
        ) {
          failedPageHandoffs++
          logger.debug("image download request failed", response)
        }
      } catch (error) {
        if (abortSignal?.aborted) throw error
        if (!writableRoot) throw error
        fsaWriteFailure ??= toFsaWriteError(error)
        throw fsaWriteFailure
      } finally {
        blobLease.release()
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

  if (comicInfoXml) {
    if (abortSignal?.aborted) throw new Error("job-cancelled")
    totalAdditionalOutputs++
    const comicInfoPath = `${chapterDir}/ComicInfo.xml`.replace(/\\/g, "/")
    const comicInfoBlobLease = runtime.liveResourceLedger.reserve(
      MAX_METADATA_RESPONSE_BYTES,
      "ComicInfo Blob"
    )
    try {
      const comicInfoBlob = new Blob([comicInfoXml], {
        type: "application/xml",
      })
      if (comicInfoBlob.size > MAX_METADATA_RESPONSE_BYTES) {
        throw new ChapterResourceLimitError(
          `ComicInfo bytes exceed ${MAX_METADATA_RESPONSE_BYTES} byte limit (got ${comicInfoBlob.size})`
        )
      }
      comicInfoBlobLease.resize(comicInfoBlob.size)
      if (writableRoot) {
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
      } else {
        await onArchiveProgress(98, "download handoff")
        const comicInfoResp = await runtime.requestBrowserBlobDownload({
          jobId,
          attempt,
          outputId: `${jobId}:image:comic-info`,
          taskId,
          chapterId: chapter.id,
          blob: comicInfoBlob,
          resourceLease: comicInfoBlobLease,
          filename: comicInfoPath,
          outputIndex: (coverImage ? 1 : 0) + total,
          outputCount,
          outputKind: "image",
          signal: abortSignal,
        })
        if (
          requireNativeOutputDisposition(comicInfoResp).disposition ===
          "not_persisted"
        ) {
          failedAdditionalHandoffs++
          logger.debug("ComicInfo.xml download request failed", comicInfoResp)
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
    } finally {
      comicInfoBlobLease.release()
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
  assertChapterImageCount(urls.length + (coverImage ? 1 : 0))

  const finalPath =
    chapter.resolvedPath || `${sanitizeFilename(chapter.title)}.${format}`
  let writableRoot: FileSystemDirectoryHandle | null = null
  if (downloadMode === "custom") {
    writableRoot = await resolveChapterWritableRoot(runtime, {
      taskId,
      chapter,
      totalImages: urls.length,
      abortSignal,
    })
  }

  const archiveAllowance = runtime.liveResourceLedger.reserve(
    2 * MAX_ARCHIVE_BYTES,
    "archive worker compressed chunks and merged result"
  )
  let session: ArchiveWorkerSession
  try {
    session = new ArchiveWorkerSession(
      createZipArchiveWorker(),
      undefined,
      undefined,
      archiveAllowance
    )
  } catch (error) {
    archiveAllowance.release()
    throw error
  }
  const archivePageCount = urls.length + (coverImage ? 1 : 0)
  let archiveResultLease: OffscreenLiveResourceLease | undefined
  let archiveBlobLease: OffscreenLiveResourceLease | undefined

  const onAbort = () => {
    session.reject(new Error("job-cancelled"))
    session.dispose()
  }
  abortSignal?.addEventListener("abort", onAbort, { once: true })

  try {
    initializeArchiveWorker({
      session,
      chapter,
      format,
      normalizeSettings,
      totalImages: archivePageCount,
    })
    addComicInfoToArchiveWorker({
      session,
      includeComicInfo,
      chapter,
      seriesTitle,
      seriesMetadata,
      pageCount: archivePageCount,
      comicInfoVersion,
      hasCoverImage: !!coverImage,
    })
    addCoverToArchiveWorker(
      session,
      runtime.liveResourceLedger,
      `${jobId}:archive-input:cover`,
      coverImage
    )

    const { total, succeeded, failed, failedUrls, failedReasons } =
      await downloadChapterImages(runtime, {
        urls,
        integrationId,
        chapterId: chapter.id,
        integrationContext: opts.integrationContext,
        rateLimitSettings: opts.settingsSnapshot.rateLimitSettings,
        rateLimitService: runtime.rateLimitService,
        abortSignal,
        onProgress,
        onImageDownloaded: opts.onImageDownloaded,
        downloadImage,
        initialAggregateBytes: coverImage?.data.byteLength ?? 0,
        mapImageIndex: (index) => index + (coverImage ? 1 : 0),
        collectFailureReasons: true,
        onDownloaded: ({ index, result }) => {
          const filename = sanitizeFilename(result.filename)
          const buffer = result.data
          const inputLease =
            result.liveResourceLease ??
            runtime.liveResourceLedger.reserve(
              buffer.byteLength,
              "untracked archive image input"
            )
          session.post(
            {
              type: "addImage",
              inputId: `${jobId}:archive-input:${index}`,
              filename,
              buffer,
              index,
              mimeType: result.mimeType,
            },
            [buffer],
            inputLease
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
      return {
        status: "failed",
        errorMessage: errorMsg,
        imagesFailed: failed,
        outputsRequested: 1,
        outputsFailedBeforeHandoff: 1,
        outputsCommitted: 0,
      }
    }

    let result
    try {
      result = await session.finalize()
    } catch (error) {
      if (abortSignal?.aborted) throw error
      const errorMsg =
        error instanceof Error ? error.message : "Archive creation failed"
      const memStats = runtime.getMemoryStats()
      if (memStats) {
        logger.error(
          `   Memory at failure: ${memStats.usedMB.toFixed(1)}MB / ${memStats.totalMB.toFixed(1)}MB`
        )
      }
      throw new Error(
        `Archive creation failed: ${errorMsg} (${succeeded}/${total} images, ${failed} failed)`,
        { cause: error }
      )
    }
    archiveResultLease = result.liveResourceLease
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
    archiveBlobLease = runtime.liveResourceLedger.reserve(
      result.buffer.byteLength,
      "archive output Blob"
    )
    const blob = new Blob([result.buffer], { type: mimeType })
    archiveResultLease?.release()
    archiveResultLease = undefined
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
      resourceLease: archiveBlobLease,
      filename: normalized,
      outputIndex: 0,
      outputCount: 1,
      outputKind: "archive",
      signal: abortSignal,
    })
    const handoff = requireNativeOutputDisposition(response)
    if (handoff.disposition === "not_persisted") {
      return {
        status: "failed",
        errorMessage: handoff.reason,
        errorCategory: "browser_download_interrupted",
        outputsRequested: 1,
        outputsFailedBeforeHandoff: 1,
        outputsCommitted: 0,
      }
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
    archiveResultLease?.release()
    archiveBlobLease?.release()
    try {
      session.dispose()
    } catch (error) {
      logger.debug("zip worker terminate failed (non-fatal)", error)
    }
  }
}
