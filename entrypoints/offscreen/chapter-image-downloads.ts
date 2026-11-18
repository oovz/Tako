import logger from "@/src/runtime/logger"
import type {
  RateLimitPolicySnapshot,
  RateLimitService,
} from "@/src/runtime/rate-limit"
import { PromiseQueue, type RetryHooks } from "./image-processor"
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
  attempts: number
}

type DownloadChapterImagesOptions = {
  urls: string[]
  taskId?: string
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
  stopOnFailure?: boolean
  isFatalError?: (error: unknown) => boolean
  initialAggregateBytes?: number
}

type DownloadChapterImagesResult = {
  total: number
  processed: number
  succeeded: number
  failed: number
  firstFailure?: DownloadChapterImageFailure
}

type ImageByteState = { receivedBytes: number; reservedBytes: number }
const deferredImageRequest = Symbol()

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
  private readonly retryingImages = new Set<number>()
  private waitingForRetries: PromiseWithResolvers<void> | undefined
  private processed = 0
  private succeeded = 0
  private failed = 0
  private firstFailure: DownloadChapterImageFailure | undefined

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
    const onAbort = () => this.cancelBatch(abortSignal?.reason)
    abortSignal?.addEventListener("abort", onAbort, { once: true })
    if (abortSignal?.aborted) onAbort()
    try {
      const tasks: Promise<void>[] = []
      for (let index = 0; index < urls.length; index++) {
        const imageIndex = this.input.mapImageIndex
          ? this.input.mapImageIndex(index)
          : index
        tasks.push(
          this.queue.add(() =>
            this.downloadOne(urls[index], imageIndex, index + 1)
          )
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
      firstFailure: this.firstFailure,
    }
  }

  private cancelBatch(reason: unknown = new Error("job-cancelled")): void {
    if (!this.controller.signal.aborted) this.controller.abort(reason)
    this.queue.cancelPending(reason)
    this.releaseWaitingRequests()
  }

  private holdNewRequests(page: number): void {
    if (!this.input.stopOnFailure || this.controller.signal.aborted) return
    this.retryingImages.add(page)
    this.waitingForRetries ??= Promise.withResolvers<void>()
  }

  private releaseWaitingRequests(): void {
    this.waitingForRetries?.resolve()
    this.waitingForRetries = undefined
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
    state: ImageByteState,
    onImageRetry: () => void
  ): Promise<ChapterDownloadImageResult> {
    this.assertActive()
    const image = await this.input.downloadImage(url, {
      signal: this.controller.signal,
      dispatchContext: this.input.integrationContext,
      runtime: {
        rateLimitSettings: this.input.rateLimitSettings,
        chapterId: this.input.chapterId,
        rateLimitService: this.input.rateLimitService,
        onImageRetry,
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
    state: ImageByteState,
    page: number,
    hooks: RetryHooks,
    onImageRetry: () => void
  ): Promise<ChapterDownloadImageResult> {
    return this.runtime.withImageRetries(
      () => this.scheduleImageRequest(url, state, page, onImageRetry),
      {
        onRetry: hooks.onRetry,
        onAttemptStart: async (attempt) => {
          this.assertActive()
          await hooks.onAttemptStart?.(attempt)
          if (attempt > 1) this.budget.release(state)
          await this.emitInFlightProgress()
        },
      },
      this.controller.signal
    )
  }

  private async scheduleImageRequest(
    url: string,
    state: ImageByteState,
    page: number,
    onImageRetry: () => void
  ): Promise<ChapterDownloadImageResult> {
    while (true) {
      this.assertActive()
      const waiting = this.waitingForRetries
      if (waiting && !this.retryingImages.has(page)) {
        await waiting.promise
        continue
      }
      const result =
        await this.input.rateLimitService.scheduleForIntegrationScope<
          ChapterDownloadImageResult | typeof deferredImageRequest
        >(
          this.input.integrationId,
          "image",
          async () => {
            // A page can fail while another is waiting for the provider's
            // pacing delay. Free this slot so the failed page can retry.
            if (this.waitingForRetries && !this.retryingImages.has(page))
              return deferredImageRequest
            // A transport already waiting for memory can start during retry
            // backoff. Cancelling the batch also aborts those waits.
            return this.fetchImage(url, state, onImageRetry)
          },
          this.input.rateLimitSettings.image
        )
      if (result !== deferredImageRequest) return result
    }
  }

  private recordFailure(
    url: string,
    index: number,
    error: unknown,
    attempts: number
  ): void {
    if (isResourceLimit(error)) {
      this.budget.failure ??= error.message
      this.cancelBatch(error)
    } else if (this.input.stopOnFailure || this.input.isFatalError?.(error)) {
      this.cancelBatch(error)
    }
    const failure = { url, index, error, attempts }
    this.failed++
    this.firstFailure ??= failure
    this.input.onDownloadFailed(failure)
  }

  private async downloadOne(
    url: string,
    index: number,
    page: number
  ): Promise<void> {
    const bytes: ImageByteState = { receivedBytes: 0, reservedBytes: 0 }
    let result: ChapterDownloadImageResult | undefined
    let attempts = 0
    const holdForRetry = () => this.holdNewRequests(page)
    try {
      this.assertActive()
      result = await this.downloadWithRetries(
        url,
        bytes,
        page,
        {
          onAttemptStart: (attempt) => {
            attempts = attempt
          },
          onRetry: (retry) => {
            holdForRetry()
            logger.warn("Chapter image retry scheduled", {
              taskId: this.input.taskId,
              chapterId: this.input.chapterId,
              integrationId: this.input.integrationId,
              page,
              url,
              ...retry,
            })
          },
        },
        holdForRetry
      )
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
      if (this.input.stopOnFailure && this.controller.signal.aborted) return
      this.recordFailure(url, index, error, attempts)
    } finally {
      result?.liveResourceLease.release()
      if (this.retryingImages.delete(page) && this.retryingImages.size === 0)
        this.releaseWaitingRequests()
    }
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

export async function downloadChapterImages(
  runtime: ChapterProcessingRuntime,
  input: DownloadChapterImagesOptions
): Promise<DownloadChapterImagesResult> {
  return await new ChapterImageBatch(runtime, input).run()
}
