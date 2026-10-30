import logger from "@/src/runtime/logger"
import { redactDiagnosticText } from "@/src/runtime/diagnostic-redaction"
import { sanitizeFilename } from "@/src/shared/filename-sanitizer"
import { assertNonemptyImagePayload } from "@/src/shared/site-integration-utils"
import { MAX_ARCHIVE_BYTES } from "@/src/constants/timeouts"
import type { OffscreenLiveResourceLease } from "@/src/runtime/offscreen-live-resource-ledger"
import createZipArchiveWorker from "./archive-worker-factory"
import { ArchiveWorkerSession } from "./archive-worker-session"
import { downloadChapterImages } from "./chapter-image-downloads"
import { normalizeDownloadPath } from "./chapter-processing-helpers"
import {
  getConflictPolicy,
  resolveChapterWritableRoot,
  writeFsaOutput,
} from "./chapter-processing-fsa"
import { requireNativeOutputDisposition } from "./chapter-processing-outcomes"
import {
  assertChapterImageCount,
  initializeArchiveWorker,
  addComicInfoToArchiveWorker,
  addCoverToArchiveWorker,
} from "./chapter-archive-worker-helpers"
import type {
  ArchiveNormalizationSettings,
  ChapterDownloadImageFn,
  ChapterOutcome,
  ChapterProcessingRuntime,
  ProcessChapterStreamingOptions,
  WorkerZipResult,
} from "./chapter-processing-types"

export type ArchiveFormatChapterInput = {
  opts: ProcessChapterStreamingOptions & { format: "cbz" | "zip" }
  urls: string[]
  integrationId: string
  downloadImage: ChapterDownloadImageFn
  normalizeSettings: ArchiveNormalizationSettings
}
type ArchiveImageBatch = Awaited<ReturnType<typeof downloadChapterImages>>
type CompleteArchive = WorkerZipResult & { buffer: ArrayBuffer }

function createArchiveSession(
  runtime: ChapterProcessingRuntime
): ArchiveWorkerSession {
  const allowance = runtime.liveResourceLedger.reserve(
    2 * MAX_ARCHIVE_BYTES,
    "archive worker compressed chunks and merged result"
  )
  try {
    return new ArchiveWorkerSession(
      createZipArchiveWorker(),
      undefined,
      undefined,
      allowance
    )
  } catch (error) {
    allowance.release()
    throw error
  }
}

function logArchiveMemory(runtime: ChapterProcessingRuntime): void {
  const memory = runtime.getMemoryStats()
  if (memory)
    logger.error(
      `   Memory at failure: ${memory.usedMB.toFixed(1)}MB / ${memory.totalMB.toFixed(1)}MB`
    )
}

function logArchiveBatch({
  total,
  succeeded,
  failed,
  failedUrls,
}: ArchiveImageBatch): void {
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
}

function incompleteArchiveOutcome(
  input: ArchiveFormatChapterInput,
  batch: ArchiveImageBatch
): ChapterOutcome {
  const { total, succeeded, failed, failedUrls, failedReasons } = batch
  const reasons =
    failedReasons.length > 0 ? ` reasons: ${failedReasons.join(" | ")}` : ""
  const message = `Image download failed: ${failed}/${total} images could not be downloaded${reasons} (${failedUrls.slice(0, 3).join(", ")}${failed > 3 ? "..." : ""})`
  logger.error(
    "❌ Chapter failed due to image failure(s) - discarding partial archive"
  )
  logger.error(`   Chapter: ${input.opts.chapter.title}`)
  logger.error(
    `   Format: ${input.opts.format} (archive format - partial archives not allowed)`
  )
  logger.error(`   ${succeeded}/${total} succeeded, ${failed} failed`)
  return {
    status: "failed",
    errorMessage: redactDiagnosticText(message),
    imagesFailed: failed,
    outputsRequested: 1,
    outputsFailedBeforeHandoff: 1,
    outputsCommitted: 0,
  }
}

/** Owns archive production, binary allocations and one final destination save. */
export class ArchiveFormatChapterOutput {
  private readonly opts: ArchiveFormatChapterInput["opts"]
  private readonly coverCount: number
  private readonly archivePageCount: number
  private readonly finalPath: string
  private writableRoot: FileSystemDirectoryHandle | null = null
  private resultLease: OffscreenLiveResourceLease | undefined
  private blobLease: OffscreenLiveResourceLease | undefined

  constructor(
    private readonly runtime: ChapterProcessingRuntime,
    private readonly input: ArchiveFormatChapterInput
  ) {
    this.opts = input.opts
    this.coverCount = this.opts.coverImage ? 1 : 0
    this.archivePageCount = input.urls.length + this.coverCount
    assertChapterImageCount(this.archivePageCount)
    if (this.opts.coverImage)
      assertNonemptyImagePayload(this.opts.coverImage.data)
    this.finalPath =
      this.opts.chapter.resolvedPath ||
      `${sanitizeFilename(this.opts.chapter.title)}.${this.opts.format}`
  }

  async run(): Promise<ChapterOutcome> {
    if (this.opts.downloadMode === "custom") {
      this.writableRoot = await resolveChapterWritableRoot(this.runtime, {
        directoryHandleId: this.opts.directoryHandleId,
        abortSignal: this.opts.abortSignal,
      })
    }
    const session = createArchiveSession(this.runtime)
    const productionSignal = this.opts.abortSignal
      ? AbortSignal.any([this.opts.abortSignal, session.failureSignal])
      : session.failureSignal
    const onAbort = () => {
      session.reject(new Error("job-cancelled"))
      session.dispose()
    }
    this.opts.abortSignal?.addEventListener("abort", onAbort, { once: true })
    try {
      return await this.produce(session, productionSignal)
    } finally {
      this.opts.abortSignal?.removeEventListener("abort", onAbort)
      this.resultLease?.release()
      this.blobLease?.release()
      try {
        session.dispose()
      } catch (error) {
        logger.debug("zip worker terminate failed (non-fatal)", error)
      }
    }
  }

  private prepareInputs(session: ArchiveWorkerSession): void {
    const {
      chapter,
      format,
      includeComicInfo,
      seriesTitle,
      seriesMetadata,
      comicInfoVersion,
      coverImage,
      jobId,
    } = this.opts
    initializeArchiveWorker({
      session,
      chapter,
      format,
      normalizeSettings: this.input.normalizeSettings,
      totalImages: this.archivePageCount,
    })
    addComicInfoToArchiveWorker({
      session,
      includeComicInfo,
      chapter,
      seriesTitle,
      seriesMetadata,
      pageCount: this.archivePageCount,
      comicInfoVersion,
      hasCoverImage: this.coverCount > 0,
    })
    addCoverToArchiveWorker(session, `${jobId}:archive-input:cover`, coverImage)
  }

  private downloadImages(
    session: ArchiveWorkerSession,
    signal: AbortSignal
  ): Promise<ArchiveImageBatch> {
    return downloadChapterImages(this.runtime, {
      urls: this.input.urls,
      integrationId: this.input.integrationId,
      chapterId: this.opts.chapter.id,
      integrationContext: this.opts.integrationContext,
      rateLimitSettings: this.opts.settingsSnapshot.rateLimitSettings,
      rateLimitService: this.runtime.rateLimitService,
      abortSignal: signal,
      onProgress: this.opts.onProgress,
      onImageDownloaded: this.opts.onImageDownloaded,
      downloadImage: this.input.downloadImage,
      initialAggregateBytes: this.opts.coverImage?.data.byteLength ?? 0,
      mapImageIndex: (index) => index + this.coverCount,
      collectFailureReasons: true,
      onDownloaded: ({ index, result }) => {
        const buffer = result.data
        session.post(
          {
            type: "addImage",
            inputId: `${this.opts.jobId}:archive-input:${index}`,
            filename: sanitizeFilename(result.filename),
            buffer,
            index,
            mimeType: result.mimeType,
          },
          [buffer],
          result.liveResourceLease
        )
      },
      onDownloadFailed: ({ url, error, failedCount, total }) => {
        logger.warn(
          `⚠️ Image download failed (${failedCount}/${total}): ${url}`,
          error
        )
      },
    }).catch((error: unknown) => {
      session.failureSignal.throwIfAborted()
      throw error
    })
  }

  private async finalize(
    session: ArchiveWorkerSession,
    batch: ArchiveImageBatch
  ): Promise<WorkerZipResult> {
    try {
      return await session.finalize()
    } catch (error) {
      if (this.opts.abortSignal?.aborted) throw error
      const message =
        error instanceof Error ? error.message : "Archive creation failed"
      logArchiveMemory(this.runtime)
      throw new Error(
        `Archive creation failed: ${message} (${batch.succeeded}/${batch.total} images, ${batch.failed} failed)`,
        { cause: error }
      )
    }
  }

  private validateArchive(
    result: WorkerZipResult,
    batch: ArchiveImageBatch
  ): asserts result is CompleteArchive {
    if (!result?.success || !result.buffer) {
      const message = result?.error || "Archive creation failed"
      logger.error(`❌ Archive creation failed: ${message}`)
      logger.error(`   Chapter: ${this.opts.chapter.title}`)
      logger.error(
        `   Images: ${batch.succeeded}/${batch.total} succeeded, ${batch.failed} failed`
      )
      logger.error(`   Format: ${this.opts.format}`)
      logArchiveMemory(this.runtime)
      throw new Error(
        `Archive creation failed: ${message} (${batch.succeeded}/${batch.total} images, ${batch.failed} failed)`
      )
    }
    if (result.imageCount !== this.archivePageCount) {
      throw new Error(
        `Archive creation failed: image count mismatch: expected ${this.archivePageCount}, got ${result.imageCount}`
      )
    }
  }

  private async produce(
    session: ArchiveWorkerSession,
    signal: AbortSignal
  ): Promise<ChapterOutcome> {
    this.prepareInputs(session)
    const batch = await this.downloadImages(session, signal)
    session.failureSignal.throwIfAborted()
    await this.opts.onArchiveProgress(90, "finalizing")
    this.assertActive()
    logArchiveBatch(batch)
    if (batch.failed > 0) return incompleteArchiveOutcome(this.input, batch)
    const result = await this.finalize(session, batch)
    this.resultLease = result.liveResourceLease
    this.validateArchive(result, batch)
    await this.opts.onArchiveProgress(95, "preparing download")
    const mimeType =
      this.opts.format === "cbz" ? "application/x-cbz" : "application/zip"
    this.blobLease = this.runtime.liveResourceLedger.reserve(
      result.buffer.byteLength,
      "archive output Blob"
    )
    const blob = new Blob([result.buffer], { type: mimeType })
    this.resultLease?.release()
    this.resultLease = undefined
    logger.debug(
      `[Archive Download] format=${this.opts.format}, finalPath=${this.finalPath}`
    )
    if (this.writableRoot)
      return await this.saveToFolder(this.writableRoot, blob)
    return await this.handoff(blob, this.blobLease)
  }

  private assertActive(): void {
    if (this.opts.abortSignal?.aborted) throw new Error("job-cancelled")
  }

  private async saveToFolder(
    root: FileSystemDirectoryHandle,
    blob: Blob
  ): Promise<ChapterOutcome> {
    try {
      await this.opts.onArchiveProgress(96, "saving")
      await writeFsaOutput({
        beginFsaWrite: this.runtime.beginFsaWrite,
        dir: root,
        path: this.finalPath,
        blob,
        collisionPolicy: getConflictPolicy(this.opts),
        signal: this.opts.abortSignal,
        onBytesWritten: () => this.opts.onArchiveProgress(96, "saving"),
      })
      await this.opts.onArchiveProgress(100, "saved")
      return {
        status: "completed",
        outputsRequested: 1,
        outputsFailedBeforeHandoff: 0,
        outputsCommitted: 1,
      }
    } catch (error) {
      if (this.opts.abortSignal?.aborted)
        throw new Error("job-cancelled", { cause: error })
      throw error
    }
  }

  private async handoff(
    blob: Blob,
    resourceLease: OffscreenLiveResourceLease
  ): Promise<ChapterOutcome> {
    const filename = normalizeDownloadPath(this.finalPath)
    await this.opts.onArchiveProgress(96, "download handoff")
    this.assertActive()
    const response = await this.runtime.requestBrowserBlobDownload({
      jobId: this.opts.jobId,
      attempt: this.opts.attempt,
      outputId: `${this.opts.jobId}:archive:0`,
      taskId: this.opts.taskId,
      chapterId: this.opts.chapter.id,
      blob,
      resourceLease,
      filename,
      outputIndex: 0,
      outputCount: 1,
      outputKind: "archive",
      signal: this.opts.abortSignal,
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
    await this.opts.onArchiveProgress(100, "download started")
    return {
      status: "completed",
      outputsRequested: 1,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 0,
    }
  }
}
