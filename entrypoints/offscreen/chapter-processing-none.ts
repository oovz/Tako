import {
  buildCoverOutputFilename,
  buildImageOutputFilename,
} from "@/src/shared/output-filenames"
import logger from "@/src/runtime/logger"
import { sanitizeFilename } from "@/src/shared/filename-sanitizer"
import { assertNonemptyImagePayload } from "@/src/shared/site-integration-utils"
import { MAX_METADATA_RESPONSE_BYTES } from "@/src/constants/timeouts"
import type { OffscreenLiveResourceLease } from "@/src/runtime/offscreen-live-resource-ledger"
import {
  ChapterResourceLimitError,
  downloadChapterImages,
  isResourceLimit,
} from "./chapter-image-downloads"
import { buildOptionalComicInfoXml } from "./chapter-processing-helpers"
import { FsaWriteError, toFsaWriteError } from "./error-categories"
import {
  createFsaDestinationFailureOutcome,
  createNoneFormatChapterOutcome,
  createNoneFormatResourceFailureOutcome,
  requireNativeOutputDisposition,
} from "./chapter-processing-outcomes"
import {
  getConflictPolicy,
  resolveChapterWritableRoot,
  writeFsaOutput,
} from "./chapter-processing-fsa"
import { assertChapterImageCount } from "./chapter-archive-worker-helpers"
import type {
  ArchiveNormalizationSettings,
  ChapterDownloadImageFn,
  ChapterDownloadImageResult,
  ChapterOutcome,
  ChapterProcessingRuntime,
  ProcessChapterStreamingOptions,
} from "./chapter-processing-types"

export type NoneFormatChapterInput = {
  opts: ProcessChapterStreamingOptions & { format: "none" }
  urls: string[]
  integrationId: string
  downloadImage: ChapterDownloadImageFn
  normalizeSettings: ArchiveNormalizationSettings
}

/** Owns one chapter's loose-file saves and the resulting output accounting. */
export class NoneFormatChapterOutput {
  private readonly opts: NoneFormatChapterInput["opts"]
  private readonly chapterDir: string
  private readonly comicInfoXml: string | null
  private readonly coverCount: number
  private readonly outputCount: number
  private readonly collisionPolicy: ReturnType<typeof getConflictPolicy>
  private writableRoot: FileSystemDirectoryHandle | null = null
  // A closed folder write or a browser handoff with durable ownership.
  private acceptedOutputs = 0
  private acceptedPageImages = 0
  private fsaWriteFailure: FsaWriteError | null = null
  private failedPageHandoffs = 0
  private failedAdditionalHandoffs = 0
  private totalAdditionalOutputs = 0

  constructor(
    private readonly runtime: ChapterProcessingRuntime,
    private readonly input: NoneFormatChapterInput
  ) {
    this.opts = input.opts
    const {
      chapter,
      coverImage,
      includeComicInfo,
      seriesTitle,
      seriesMetadata,
      comicInfoVersion,
    } = this.opts
    this.coverCount = coverImage ? 1 : 0
    assertChapterImageCount(input.urls.length + this.coverCount)
    if (coverImage) assertNonemptyImagePayload(coverImage.data)
    this.chapterDir = chapter.resolvedPath || sanitizeFilename(chapter.title)
    this.comicInfoXml = includeComicInfo
      ? buildOptionalComicInfoXml({
          includeComicInfo,
          chapter,
          seriesTitle,
          seriesMetadata,
          pageCount: input.urls.length + this.coverCount,
          comicInfoVersion,
          hasCoverImage: this.coverCount > 0,
        })
      : null
    this.outputCount =
      input.urls.length + this.coverCount + (this.comicInfoXml === null ? 0 : 1)
    this.collisionPolicy = getConflictPolicy(this.opts)
  }

  async run(): Promise<ChapterOutcome> {
    try {
      if (this.opts.downloadMode === "custom") {
        this.writableRoot = await resolveChapterWritableRoot(
          this.runtime,
          this.opts
        )
      }
      this.assertActive()
      const coverFailure = await this.saveCover()
      if (coverFailure) return coverFailure
      const { failed } = await this.downloadPages()
      this.assertActive()
      if (this.fsaWriteFailure) return this.failureOutcome(this.fsaWriteFailure)
      const metadataFailure = await this.saveComicInfo()
      if (metadataFailure) return metadataFailure
      await this.opts.onArchiveProgress(
        100,
        this.writableRoot ? "saved" : "download started"
      )
      return createNoneFormatChapterOutcome({
        downloadMode: this.outputMode,
        totalImages: this.input.urls.length,
        failedImages: failed + this.failedPageHandoffs,
        totalAdditionalOutputs: this.totalAdditionalOutputs,
        failedAdditionalOutputs: this.failedAdditionalHandoffs,
      })
    } catch (error) {
      if (!isResourceLimit(error)) throw error
      if (this.opts.abortSignal?.aborted) {
        throw new Error("job-cancelled", { cause: error })
      }
      return createNoneFormatResourceFailureOutcome({
        error,
        downloadMode: this.outputMode,
        outputsRequested: this.outputCount,
        outputsAccepted: this.acceptedOutputs,
        totalImages: this.input.urls.length,
        imagesAccepted: this.acceptedPageImages,
      })
    }
  }

  private get outputMode(): "custom" | "browser" {
    return this.writableRoot ? "custom" : "browser"
  }

  private assertActive(): void {
    if (this.opts.abortSignal?.aborted) throw new Error("job-cancelled")
  }

  private failureOutcome(error: FsaWriteError): ChapterOutcome {
    return createFsaDestinationFailureOutcome({
      error,
      outputsRequested: this.outputCount,
      outputsCommitted: this.acceptedOutputs,
      totalImages: this.input.urls.length,
      committedImages: this.acceptedPageImages,
    })
  }

  private additionalOutputFailure(error: unknown): ChapterOutcome {
    if (this.opts.abortSignal?.aborted)
      throw new Error("job-cancelled", { cause: error })
    if (isResourceLimit(error) || !this.writableRoot) throw error
    this.fsaWriteFailure = toFsaWriteError(error)
    return this.failureOutcome(this.fsaWriteFailure)
  }

  private async writeFolderOutput(
    root: FileSystemDirectoryHandle,
    path: string,
    blob: Blob,
    signal: AbortSignal,
    progress: () => Promise<void>
  ): Promise<void> {
    await progress()
    await writeFsaOutput({
      beginFsaWrite: this.runtime.beginFsaWrite,
      dir: root,
      path,
      blob,
      collisionPolicy: this.collisionPolicy,
      signal,
      onBytesWritten: progress,
    })
    this.acceptedOutputs++
  }

  private async handoff(input: {
    blob: Blob
    resourceLease: OffscreenLiveResourceLease
    path: string
    suffix: string
    index: number
    logLabel: string
  }): Promise<boolean> {
    const response = await this.runtime.requestBrowserBlobDownload({
      jobId: this.opts.jobId,
      attempt: this.opts.attempt,
      outputId: `${this.opts.jobId}:image:${input.suffix}`,
      taskId: this.opts.taskId,
      chapterId: this.opts.chapter.id,
      blob: input.blob,
      resourceLease: input.resourceLease,
      filename: input.path,
      outputIndex: input.index,
      outputCount: this.outputCount,
      outputKind: "image",
      signal: this.opts.abortSignal,
    })
    if (
      requireNativeOutputDisposition(response).disposition === "not_persisted"
    ) {
      logger.debug(input.logLabel, response)
      return false
    }
    this.acceptedOutputs++
    return true
  }

  private async saveCover(): Promise<ChapterOutcome | undefined> {
    const cover = this.opts.coverImage
    if (!cover) return undefined
    this.totalAdditionalOutputs++
    const path =
      `${this.chapterDir}/${buildCoverOutputFilename(cover.mimeType)}`.replace(
        /\\/g,
        "/"
      )
    const lease = this.runtime.liveResourceLedger.reserve(
      cover.data.byteLength,
      "none-format cover Blob"
    )
    try {
      const blob = new Blob([cover.data], {
        type: cover.mimeType || "application/octet-stream",
      })
      if (this.writableRoot) {
        await this.writeFolderOutput(
          this.writableRoot,
          path,
          blob,
          this.opts.abortSignal,
          () => this.opts.onProgress(10, "saving cover")
        )
      } else {
        await this.opts.onProgress(10, "download handoff")
        if (
          !(await this.handoff({
            blob,
            resourceLease: lease,
            path,
            suffix: "cover",
            index: 0,
            logLabel: "cover image download request failed",
          }))
        )
          this.failedAdditionalHandoffs++
      }
    } catch (error) {
      return this.additionalOutputFailure(error)
    } finally {
      lease.release()
    }
  }

  private downloadPages() {
    return downloadChapterImages(this.runtime, {
      urls: this.input.urls,
      integrationId: this.input.integrationId,
      chapterId: this.opts.chapter.id,
      integrationContext: this.opts.integrationContext,
      rateLimitSettings: this.opts.settingsSnapshot.rateLimitSettings,
      rateLimitService: this.runtime.rateLimitService,
      abortSignal: this.opts.abortSignal,
      onProgress: this.opts.onProgress,
      onImageDownloaded: this.opts.onImageDownloaded,
      downloadImage: this.input.downloadImage,
      initialAggregateBytes: this.opts.coverImage?.data.byteLength ?? 0,
      onDownloaded: (image) => this.savePage(image),
      onDownloadFailed: ({ url, error }) =>
        logger.warn(`⚠️ Image download failed (skipped): ${url}`, error),
      isFatalError: (error) => error instanceof FsaWriteError,
    })
  }

  private async savePage({
    index,
    result,
    signal,
  }: {
    index: number
    result: ChapterDownloadImageResult
    signal: AbortSignal
  }): Promise<void> {
    this.assertActive()
    const filename = buildImageOutputFilename({
      index,
      totalImages: this.input.urls.length,
      originalFilename: sanitizeFilename(result.filename),
      mimeType: result.mimeType,
      normalizeImageFilenames:
        this.input.normalizeSettings.normalizeImageFilenames,
      imagePaddingDigits: this.input.normalizeSettings.imagePaddingDigits,
    })
    const path = `${this.chapterDir}/${filename}`.replace(/\\/g, "/")
    const lease = this.runtime.liveResourceLedger.reserve(
      result.data.byteLength,
      "none-format image Blob"
    )
    try {
      const blob = new Blob([result.data], {
        type: result.mimeType || "application/octet-stream",
      })
      if (this.writableRoot) {
        if (this.fsaWriteFailure) throw this.fsaWriteFailure
        // Loose-file writes overlap the image pipeline's downloading phase.
        await this.writeFolderOutput(
          this.writableRoot,
          path,
          blob,
          signal,
          () => this.opts.onProgress(10, "saving images")
        )
        this.acceptedPageImages++
        return
      }
      await this.opts.onProgress(10, "download handoff")
      if (
        !(await this.handoff({
          blob,
          resourceLease: lease,
          path,
          suffix: String(index),
          index: this.coverCount + index,
          logLabel: "image download request failed",
        }))
      )
        this.failedPageHandoffs++
      else this.acceptedPageImages++
    } catch (error) {
      this.failPage(error)
    } finally {
      lease.release()
    }
  }

  private failPage(error: unknown): never {
    if (this.opts.abortSignal?.aborted) throw error
    if (!this.writableRoot) throw error
    this.fsaWriteFailure ??= toFsaWriteError(error)
    throw this.fsaWriteFailure
  }

  private async saveComicInfo(): Promise<ChapterOutcome | undefined> {
    if (!this.comicInfoXml) return undefined
    this.assertActive()
    this.totalAdditionalOutputs++
    const path = `${this.chapterDir}/ComicInfo.xml`.replace(/\\/g, "/")
    const lease = this.runtime.liveResourceLedger.reserve(
      MAX_METADATA_RESPONSE_BYTES,
      "ComicInfo Blob"
    )
    try {
      const blob = new Blob([this.comicInfoXml], { type: "application/xml" })
      if (blob.size > MAX_METADATA_RESPONSE_BYTES) {
        throw new ChapterResourceLimitError(
          `ComicInfo bytes exceed ${MAX_METADATA_RESPONSE_BYTES} byte limit (got ${blob.size})`
        )
      }
      lease.resize(blob.size)
      if (this.writableRoot) {
        await this.writeFolderOutput(
          this.writableRoot,
          path,
          blob,
          this.opts.abortSignal,
          () => this.opts.onArchiveProgress(98, "saving metadata")
        )
      } else {
        await this.opts.onArchiveProgress(98, "download handoff")
        if (
          !(await this.handoff({
            blob,
            resourceLease: lease,
            path,
            suffix: "comic-info",
            index: this.coverCount + this.input.urls.length,
            logLabel: "ComicInfo.xml download request failed",
          }))
        )
          this.failedAdditionalHandoffs++
      }
    } catch (error) {
      return this.additionalOutputFailure(error)
    } finally {
      lease.release()
    }
  }
}
