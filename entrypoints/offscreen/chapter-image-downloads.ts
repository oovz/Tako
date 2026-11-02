import logger from "@/src/runtime/logger"
import type {
  RateLimitPolicySnapshot,
  RateLimitService,
} from "@/src/runtime/rate-limit"
import { PromiseQueue } from "./image-processor"
import type {
  ChapterDownloadImageFn,
  ChapterDownloadImageResult,
  ChapterProcessingRuntime,
} from "./chapter-processing-types"
import {
  MAX_CHAPTER_IMAGE_BYTES,
  MAX_CHAPTER_IMAGES,
  MAX_IMAGE_BYTES,
} from "@/src/constants/timeouts"
import { NonRetryableDownloadError } from "@/src/shared/download-contract"
import { assertNonemptyImagePayload } from "@/src/shared/site-integration-utils"
import { OffscreenLiveResourceLimitError } from "@/src/runtime/offscreen-live-resource-ledger"
import type { JsonObject } from "@/src/types/site-integrations"

export class ChapterResourceLimitError extends NonRetryableDownloadError {
  constructor(message: string) {
    super(message)
    this.name = "ChapterResourceLimitError"
  }
}

type DownloadChapterImageSuccess = {
  url: string
  index: number
  result: ChapterDownloadImageResult
  signal: AbortSignal
}

type DownloadChapterImageFailure = {
  url: string
  index: number
  error: unknown
  failedCount: number
  total: number
}

type DownloadChapterImagesOptions = {
  urls: string[]
  integrationId: string
  chapterId: string
  integrationContext?: JsonObject
  rateLimitSettings: RateLimitPolicySnapshot
  rateLimitService: RateLimitService
  abortSignal?: AbortSignal
  onProgress: (
    pct: number,
    label?: string,
    imageProgress?: { current: number; total: number }
  ) => Promise<void>
  onImageDownloaded?: () => void
  downloadImage: ChapterDownloadImageFn
  onDownloaded: (image: DownloadChapterImageSuccess) => void | Promise<void>
  onDownloadFailed: (failure: DownloadChapterImageFailure) => void
  mapImageIndex?: (index: number) => number
  collectFailureReasons?: boolean
  isFatalError?: (error: unknown) => boolean
  initialAggregateBytes?: number
}

type DownloadChapterImagesResult = {
  total: number
  processed: number
  succeeded: number
  failed: number
  failedUrls: string[]
  failedReasons: string[]
}

type ImageByteState = { receivedBytes: number; reservedBytes: number }

class ChapterImageByteBudget {
  private reservedBytes = 0
  private committedBytes: number
  failure: string | null = null

  constructor(initialBytes: number) {
    if (initialBytes > MAX_CHAPTER_IMAGE_BYTES) {
      throw new ChapterResourceLimitError(
        `Chapter image bytes exceed ${MAX_CHAPTER_IMAGE_BYTES} byte limit (got ${initialBytes})`
      )
    }
    this.committedBytes = initialBytes
  }

  reserve(state: ImageByteState, bytes: number): void {
    if (bytes <= 0) return
    const nextTotal = this.committedBytes + this.reservedBytes + bytes
    if (nextTotal > MAX_CHAPTER_IMAGE_BYTES) {
      this.failure ??= `Chapter image bytes exceed ${MAX_CHAPTER_IMAGE_BYTES} byte limit (got ${nextTotal})`
      throw new ChapterResourceLimitError(this.failure)
    }
    this.reservedBytes += bytes
    state.reservedBytes += bytes
  }

  release(state: ImageByteState): void {
    this.reservedBytes -= state.reservedBytes
    state.receivedBytes = 0
    state.reservedBytes = 0
  }

  commit(state: ImageByteState): void {
    this.committedBytes += state.reservedBytes
    this.release(state)
  }

  reconcile(state: ImageByteState, resultBytes: number): void {
    if (resultBytes > MAX_IMAGE_BYTES) {
      throw new ChapterResourceLimitError(
        `Transformed image size exceeds ${MAX_IMAGE_BYTES} byte limit (got ${resultBytes})`
      )
    }
    if (resultBytes > state.reservedBytes) {
      this.reserve(state, resultBytes - state.reservedBytes)
    } else if (resultBytes < state.reservedBytes) {
      this.reservedBytes -= state.reservedBytes - resultBytes
      state.reservedBytes = resultBytes
    }
  }
}

export function isResourceLimit(
  error: unknown
): error is ChapterResourceLimitError | OffscreenLiveResourceLimitError {
  return (
    error instanceof ChapterResourceLimitError ||
    error instanceof OffscreenLiveResourceLimitError
  )
}

/** One image batch owns its aggregate bytes, queue, cancellation and outcomes. */
class ChapterImageBatch {
  private readonly queue: PromiseQueue
  private readonly budget: ChapterImageByteBudget
  private readonly controller = new AbortController()
  private processed = 0
  private succeeded = 0
  private failed = 0
  private readonly failedUrls: string[] = []
  private readonly failedReasons: string[] = []

  constructor(
    private readonly runtime: ChapterProcessingRuntime,
    private readonly input: DownloadChapterImagesOptions
  ) {
    if (input.urls.length > MAX_CHAPTER_IMAGES) {
      throw new ChapterResourceLimitError(
        `Chapter image count exceeds ${MAX_CHAPTER_IMAGES} image limit (got ${input.urls.length})`
      )
    }
    const { initialAggregateBytes = 0 } = input
    this.budget = new ChapterImageByteBudget(initialAggregateBytes)
    this.queue = new PromiseQueue(input.rateLimitSettings.image.concurrency)
  }

  async run(): Promise<DownloadChapterImagesResult> {
    const { abortSignal, urls } = this.input
    const onAbort = () => this.cancelPending(abortSignal?.reason)
    abortSignal?.addEventListener("abort", onAbort, { once: true })
    if (abortSignal?.aborted) onAbort()
    try {
      const tasks: Promise<void>[] = []
      for (let index = 0; index < urls.length; index++) {
        const imageIndex = this.input.mapImageIndex
          ? this.input.mapImageIndex(index)
          : index
        tasks.push(
          this.queue.add(() => this.downloadOne(urls[index], imageIndex))
        )
      }
      await Promise.allSettled(tasks)
    } finally {
      abortSignal?.removeEventListener("abort", onAbort)
    }
    if (this.budget.failure)
      throw new ChapterResourceLimitError(this.budget.failure)
    const result = this.result()
    logger.debug("chapter image download batch complete", {
      total: result.total,
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
    })
    return result
  }

  private result(): DownloadChapterImagesResult {
    return {
      total: this.input.urls.length,
      processed: this.processed,
      succeeded: this.succeeded,
      failed: this.failed,
      failedUrls: this.failedUrls,
      failedReasons: this.failedReasons,
    }
  }

  private cancelPending(reason: unknown = new Error("job-cancelled")): void {
    if (!this.controller.signal.aborted) this.controller.abort(reason)
    this.queue.cancelPending(reason)
  }

  private assertActive(): void {
    if (this.controller.signal.aborted) throw new Error("job-cancelled")
  }

  private async emitInFlightProgress(): Promise<void> {
    try {
      await this.input.onProgress(10, "downloading", {
        current: this.processed,
        total: this.input.urls.length,
      })
    } catch (error) {
      logger.debug("image in-flight progress update failed (non-fatal)", error)
    }
  }

  private async reportImageBytes(
    state: ImageByteState,
    bytesReceived: number
  ): Promise<void> {
    const normalized = Math.max(0, Math.trunc(bytesReceived))
    this.budget.reserve(state, normalized - state.receivedBytes)
    state.receivedBytes = normalized
    await this.emitInFlightProgress()
  }

  private async fetchImage(
    url: string,
    state: ImageByteState
  ): Promise<ChapterDownloadImageResult> {
    this.assertActive()
    const image = await this.input.downloadImage(url, {
      signal: this.controller.signal,
      dispatchContext: this.input.integrationContext,
      runtime: {
        rateLimitSettings: this.input.rateLimitSettings,
        chapterId: this.input.chapterId,
        rateLimitService: this.input.rateLimitService,
      },
      onBytesReceived: (bytes) => this.reportImageBytes(state, bytes),
      liveResourceLedger: this.runtime.liveResourceLedger,
    })
    try {
      assertNonemptyImagePayload(image.data)
      return image
    } catch (error) {
      image?.liveResourceLease.release()
      throw error
    }
  }

  private downloadWithRetries(
    url: string,
    state: ImageByteState
  ): Promise<ChapterDownloadImageResult> {
    return this.runtime.withImageRetries(
      () =>
        this.input.rateLimitService.scheduleForIntegrationScope(
          this.input.integrationId,
          "image",
          () => this.fetchImage(url, state),
          this.input.rateLimitSettings.image
        ),
      {
        onAttemptStart: async (attempt) => {
          this.assertActive()
          if (attempt > 1) this.budget.release(state)
          await this.emitInFlightProgress()
        },
      },
      this.controller.signal
    )
  }

  private recordFailure(url: string, index: number, error: unknown): void {
    if (isResourceLimit(error)) {
      this.budget.failure ??= error.message
      this.cancelPending(error)
    } else if (this.input.isFatalError?.(error)) {
      this.cancelPending(error)
    }
    this.rememberFailure(url, error)
    this.input.onDownloadFailed({
      url,
      index,
      error,
      failedCount: this.failed,
      total: this.input.urls.length,
    })
  }

  private rememberFailure(url: string, error: unknown): void {
    this.failed++
    this.failedUrls.push(url)
    if (this.input.collectFailureReasons && this.failedReasons.length < 3) {
      const reason = error instanceof Error ? error.message : String(error)
      this.failedReasons.push(`${url} => ${reason}`)
    }
  }

  private async downloadOne(url: string, index: number): Promise<void> {
    const bytes: ImageByteState = { receivedBytes: 0, reservedBytes: 0 }
    let result: ChapterDownloadImageResult | undefined
    try {
      this.assertActive()
      result = await this.downloadWithRetries(url, bytes)
      this.controller.signal.throwIfAborted()
      if (this.budget.failure)
        throw new ChapterResourceLimitError(this.budget.failure)
      this.budget.reconcile(bytes, result.data.byteLength)
      await this.input.onDownloaded({
        url,
        index,
        result,
        signal: this.controller.signal,
      })
      this.budget.commit(bytes)
      this.succeeded++
      this.input.onImageDownloaded?.()
    } catch (error) {
      this.budget.release(bytes)
      this.recordFailure(url, index, error)
    } finally {
      result?.liveResourceLease.release()
      this.processed++
      const pct = Math.max(
        10,
        Math.round((this.processed / this.input.urls.length) * 100)
      )
      await this.input.onProgress(pct, undefined, {
        current: this.processed,
        total: this.input.urls.length,
      })
    }
  }
}

export async function downloadChapterImages(
  runtime: ChapterProcessingRuntime,
  input: DownloadChapterImagesOptions
): Promise<DownloadChapterImagesResult> {
  return await new ChapterImageBatch(runtime, input).run()
}
