/**
 * Offscreen document runtime for archive creation, image processing,
 * and background-assisted downloads.
 */

import type { Chapter } from "@/src/types/chapter"
import type {
  OffscreenDownloadProgressMessage,
  OffscreenParseSeriesHtmlResponse,
} from "@/src/types/offscreen-messages"
import type {
  OffscreenDownloadChapterPayload,
  OffscreenParseSeriesHtmlPayload,
} from "@/src/runtime/message-schemas"
import { withRetries, fetchChapterHtml } from "./image-processor"
import { siteIntegrationRegistry } from "@/src/runtime/site-integration-registry"
import { initializeOffscreenSiteIntegrations } from "@/src/runtime/site-integration-offscreen-initialization"
import logger from "@/src/runtime/logger"
import { DEFAULT_FETCH_TIMEOUT_MS } from "@/src/constants/timeouts"
import {
  type ArchiveNormalizationSettings,
  type ChapterDownloadImageFn,
  type ChapterOutcome,
  type ChapterProcessingRuntime,
  type ProcessChapterStreamingOptions,
  type ProcessDownloadChapterSettingsSnapshot,
  processArchiveFormatChapter,
  processNoneFormatChapter,
} from "./chapter-processing"
import {
  prefetchOptionalCoverImage,
  requestBrowserBlobDownload,
  resolveWritableDownloadRoot,
} from "./download-runtime-helpers"
import {
  createStreamingProgressHandlers,
  createTerminalProgressPayload,
  type UnsequencedProgressPayload,
} from "./progress-helpers"
import {
  createChapterForProcessing,
  createProcessChapterStreamingOptions,
  readProcessDownloadChapterSettingsSnapshot,
} from "./download-request-mappers"
import { classifyOffscreenErrorCategory } from "./error-categories"
import { registerOffscreenRuntime } from "./runtime-bridge"
import { createOffscreenStatusController } from "./status-ui"
import { OFFSCREEN_HEARTBEAT_INTERVAL_MS } from "@/src/constants/timeouts"
import type { OffscreenJobStage } from "@/src/types/queue-state"
import type { OffscreenJobState } from "@/src/types/offscreen-messages"

// Chrome extension offscreen document: DOM/web APIs are available here, but
// chrome.runtime is the only Chrome extension API exposed to this context.
// All storage operations must be requested from the service worker via messaging.

// Performance memory API types (Chrome-specific)
interface PerformanceMemory {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

interface ExtendedPerformance extends Performance {
  memory?: PerformanceMemory
}

type TaskControllerEntry = {
  controller: AbortController
  activeCount: number
}

type JobExecutionContext = {
  integrationId: string
  retries: { image: number; chapter: number }
  handlesOwnRetries: boolean
}

type PendingChapterProgressEntry = {
  payload: OffscreenDownloadProgressMessage["payload"]
  timerId: ReturnType<typeof setTimeout>
}

type OffscreenJobRecord = {
  request: OffscreenDownloadChapterPayload
  controller: AbortController
  stage: OffscreenJobStage
  sequence: number
  status: "active" | "terminal" | "canceled"
  outcome?: ChapterOutcome
  promise: Promise<ChapterOutcome>
  heartbeatTimer?: ReturnType<typeof setInterval>
  updatedAt: number
}

function awaitWithTimeoutAndSignal<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      signal?.removeEventListener("abort", onAbort)
      callback()
    }
    const onAbort = () => finish(() => reject(new Error("job-cancelled")))
    const timeoutId = setTimeout(
      () => finish(() => reject(new Error("resolveImageUrls timeout"))),
      timeoutMs
    )
    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    void promise.then(
      (value) => finish(() => resolve(value)),
      (error) =>
        finish(() =>
          reject(
            error instanceof Error
              ? error
              : new Error("Chapter URL resolution failed", { cause: error })
          )
        )
    )
  })
}

/**
 * Offscreen Worker Manager
 */
export class OffscreenWorker {
  private readonly chapterProgressLastSentAt = new Map<string, number>()
  private readonly pendingChapterProgress = new Map<
    string,
    PendingChapterProgressEntry
  >()
  private readonly activeTaskControllers = new Map<
    string,
    TaskControllerEntry
  >()
  private readonly jobs = new Map<string, OffscreenJobRecord>()

  async initialize(): Promise<void> {
    try {
      logger.debug("🔧 Initializing offscreen worker...")

      // Initialize site integration registry first (required for findSiteIntegrationForUrl)
      logger.debug("🔌 Initializing site integration registry in offscreen...")
      await initializeOffscreenSiteIntegrations()

      logger.debug(
        "✅ Offscreen worker initialized - ready for centralized processing"
      )
    } catch (error) {
      logger.error("❌ Failed to initialize offscreen worker:", error)
      throw error
    }
  }

  /**
   * Get current memory usage statistics
   * Expose memory stats for debugging
   */
  getMemoryStats(): {
    usedMB: number
    totalMB: number
    limitMB: number
  } | null {
    const perf = performance as ExtendedPerformance
    if ("memory" in performance && perf.memory) {
      const memory = perf.memory
      return {
        usedMB: memory.usedJSHeapSize / (1024 * 1024),
        totalMB: memory.totalJSHeapSize / (1024 * 1024),
        limitMB: memory.jsHeapSizeLimit / (1024 * 1024),
      }
    }
    return null
  }

  private async withImageRetries<T>(
    job: JobExecutionContext,
    fn: () => Promise<T>,
    hooks?: { onAttemptStart?: (attempt: number) => void | Promise<void> },
    signal?: AbortSignal
  ): Promise<T> {
    if (job.handlesOwnRetries) {
      await hooks?.onAttemptStart?.(1)
      return fn()
    }
    return withRetries(fn, job.retries.image, 1000, hooks, signal)
  }

  private async resolveWritableDownloadRoot(input: {
    taskId: string
    chapter: Chapter
    totalImages: number
  }): Promise<FileSystemDirectoryHandle> {
    return await resolveWritableDownloadRoot(input)
  }

  private requestBrowserBlobDownload(input: {
    jobId: string
    attempt: number
    outputId: string
    taskId: string
    chapterId: string
    blob: Blob
    filename: string
    outputIndex: number
    outputCount: number
    outputKind: "archive" | "image"
    signal?: AbortSignal
  }): ReturnType<typeof requestBrowserBlobDownload> {
    return requestBrowserBlobDownload(input)
  }

  private acquireTaskController(taskId: string): TaskControllerEntry {
    let taskControllerEntry = this.activeTaskControllers.get(taskId)
    if (!taskControllerEntry || taskControllerEntry.controller.signal.aborted) {
      taskControllerEntry = {
        controller: new AbortController(),
        activeCount: 0,
      }
      this.activeTaskControllers.set(taskId, taskControllerEntry)
    }

    taskControllerEntry.activeCount += 1
    return taskControllerEntry
  }

  private createJobExecutionContext(
    siteIntegrationId: string,
    settingsSnapshot: ProcessDownloadChapterSettingsSnapshot
  ): JobExecutionContext {
    const retries = settingsSnapshot.retrySettings
    const integrationMeta = siteIntegrationRegistry.findById(siteIntegrationId)
    return {
      integrationId: siteIntegrationId,
      retries,
      handlesOwnRetries: integrationMeta?.handlesOwnRetries === true,
    }
  }

  private releaseTaskController(
    taskId: string,
    controller: AbortController
  ): void {
    const currentTaskControllerEntry = this.activeTaskControllers.get(taskId)
    if (
      !currentTaskControllerEntry ||
      currentTaskControllerEntry.controller !== controller
    ) {
      return
    }

    currentTaskControllerEntry.activeCount -= 1
    if (currentTaskControllerEntry.activeCount <= 0) {
      this.activeTaskControllers.delete(taskId)
    }
  }

  public processDownloadChapter(
    request: OffscreenDownloadChapterPayload
  ): Promise<ChapterOutcome> {
    const existing = this.jobs.get(request.jobId)
    if (existing) {
      if (
        existing.request.attempt !== request.attempt ||
        existing.request.taskId !== request.taskId ||
        existing.request.chapter.id !== request.chapter.id
      ) {
        return Promise.reject(new Error("Job identity collision"))
      }
      return existing.promise
    }

    const supersededExecutions: Promise<ChapterOutcome>[] = []
    for (const job of this.jobs.values()) {
      if (
        job.request.taskId !== request.taskId ||
        job.request.chapter.id !== request.chapter.id
      ) {
        continue
      }
      if (job.request.attempt > request.attempt) {
        return Promise.reject(new Error("Stale chapter dispatch attempt"))
      }
      if (job.request.attempt === request.attempt) {
        return Promise.reject(new Error("Chapter dispatch identity collision"))
      }
      supersededExecutions.push(job.promise)
      if (job.status === "active") {
        // Abort first, then use the promise barrier below. Abort is advisory:
        // an older attempt may still be inside a non-abortable browser/FSA
        // operation and must settle before the replacement starts.
        job.status = "canceled"
        job.updatedAt = Date.now()
        this.stopJobHeartbeat(job)
        job.controller.abort("Superseded by a newer dispatch attempt")
        this.clearPendingChapterProgress(
          `${job.request.taskId}:${job.request.chapter.id}`
        )
      }
    }

    const taskControllerEntry = this.acquireTaskController(request.taskId)
    const record: OffscreenJobRecord = {
      request,
      controller: taskControllerEntry.controller,
      stage: "dispatching",
      sequence: 0,
      status: "active",
      promise: Promise.resolve({ status: "failed" as const }),
      updatedAt: Date.now(),
    }
    record.promise = Promise.allSettled(supersededExecutions).then(() =>
      this.executeDownloadChapter(record, taskControllerEntry)
    )
    this.jobs.set(request.jobId, record)
    this.pruneTerminalJobs()
    return record.promise
  }

  private async executeDownloadChapter(
    record: OffscreenJobRecord,
    taskControllerEntry: TaskControllerEntry
  ): Promise<ChapterOutcome> {
    const { request } = record
    let taskControllerReleased = false
    const releaseTaskControllerOnce = (): void => {
      if (taskControllerReleased) return
      taskControllerReleased = true
      this.releaseTaskController(request.taskId, taskControllerEntry.controller)
    }

    try {
      await this.sendJobAccepted(record)
      this.startJobHeartbeat(record)
      await this.waitForNotBefore(record)

      const snapshot = readProcessDownloadChapterSettingsSnapshot(
        request.settingsSnapshot
      )
      const chapterForProcessing = createChapterForProcessing(request.chapter)
      const job = this.createJobExecutionContext(
        request.book.siteIntegrationId,
        request.settingsSnapshot
      )
      const latestImageProgress = { current: 0, total: 0 }
      const progressHandlers = createStreamingProgressHandlers({
        taskId: request.taskId,
        chapterId: request.chapter.id,
        chapterTitle: request.chapter.title,
        latestImageProgress,
        emitProgressMessage: (payload) =>
          this.sendJobProgressMessage(record, payload),
      })

      const coverImage = await prefetchOptionalCoverImage({
        includeCoverImage: snapshot.includeCoverImage,
        coverUrl: request.book.coverUrl,
        integrationId: job.integrationId,
        integrationContext: request.integrationContext,
        rateLimitSettings: snapshot.rateLimitSettings,
        signal: taskControllerEntry.controller.signal,
        onActivity: () => progressHandlers.onArchiveProgress(0, "cover"),
        withImageRetries: <T>(
          fn: () => Promise<T>,
          hooks?: {
            onAttemptStart?: (attempt: number) => void | Promise<void>
          }
        ) =>
          this.withImageRetries(
            job,
            fn,
            hooks,
            taskControllerEntry.controller.signal
          ),
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
      const outcome = await this.processChapterStreaming(streamingOptions, job)

      if (taskControllerEntry.controller.signal.aborted) {
        record.status = "canceled"
        record.outcome = outcome
        record.updatedAt = Date.now()
        this.clearPendingChapterProgress(
          `${request.taskId}:${request.chapter.id}`
        )
        return outcome
      }

      releaseTaskControllerOnce()
      record.status = "terminal"
      record.stage = "saving"
      record.outcome = outcome
      record.updatedAt = Date.now()

      await this.sendJobProgressMessage(
        record,
        createTerminalProgressPayload({
          taskId: request.taskId,
          chapterId: request.chapter.id,
          chapterTitle: request.chapter.title,
          outcome,
          totalImages: latestImageProgress.total,
          imagesProcessed: latestImageProgress.current,
        })
      )
      return outcome
    } catch (error) {
      const outcome: ChapterOutcome = {
        status: "failed",
        errorMessage:
          error instanceof Error ? error.message : "Failed to process chapter",
        errorCategory: classifyOffscreenErrorCategory(error),
      }
      record.status = taskControllerEntry.controller.signal.aborted
        ? "canceled"
        : "terminal"
      record.stage = "saving"
      record.outcome = outcome
      record.updatedAt = Date.now()
      if (!taskControllerEntry.controller.signal.aborted) {
        releaseTaskControllerOnce()
        await this.sendJobProgressMessage(
          record,
          createTerminalProgressPayload({
            taskId: request.taskId,
            chapterId: request.chapter.id,
            chapterTitle: request.chapter.title,
            outcome,
            totalImages: 0,
            imagesProcessed: 0,
          })
        )
      }
      return outcome
    } finally {
      this.stopJobHeartbeat(record)
      releaseTaskControllerOnce()
    }
  }

  private nextJobSequence(record: OffscreenJobRecord): number {
    record.sequence += 1
    record.updatedAt = Date.now()
    return record.sequence
  }

  private async sendJobAccepted(record: OffscreenJobRecord): Promise<void> {
    record.stage = "accepted"
    const sequence = this.nextJobSequence(record)
    // The service worker's positive acknowledgement is the execution fence.
    // In particular, a canceled or replaced lease must not continue merely
    // because the offscreen document already received the dispatch envelope.
    await this.sendMessageWithRetry({
      type: "OFFSCREEN_JOB_ACCEPTED",
      payload: {
        jobId: record.request.jobId,
        attempt: record.request.attempt,
        taskId: record.request.taskId,
        chapterId: record.request.chapter.id,
        acceptedAt: Date.now(),
        sequence,
      },
    })
  }

  private startJobHeartbeat(record: OffscreenJobRecord): void {
    this.stopJobHeartbeat(record)
    record.heartbeatTimer = setInterval(() => {
      if (record.status !== "active") return
      void this.sendJobHeartbeat(record).catch((error) => {
        logger.debug("Job heartbeat delivery failed (will retry)", error)
      })
    }, OFFSCREEN_HEARTBEAT_INTERVAL_MS)
  }

  private stopJobHeartbeat(record: OffscreenJobRecord): void {
    if (record.heartbeatTimer !== undefined) {
      clearInterval(record.heartbeatTimer)
      record.heartbeatTimer = undefined
    }
  }

  private async sendJobHeartbeat(record: OffscreenJobRecord): Promise<void> {
    const sequence = this.nextJobSequence(record)
    await this.sendMessageWithRetry({
      type: "OFFSCREEN_JOB_HEARTBEAT",
      payload: {
        jobId: record.request.jobId,
        attempt: record.request.attempt,
        taskId: record.request.taskId,
        chapterId: record.request.chapter.id,
        stage: record.stage,
        sequence,
        sentAt: Date.now(),
      },
    })
  }

  private async waitForNotBefore(record: OffscreenJobRecord): Promise<void> {
    if (record.controller.signal.aborted) {
      throw new Error("job-cancelled")
    }
    const notBefore = record.request.notBefore ?? 0
    const delayMs = Math.max(0, notBefore - Date.now())
    if (delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer)
          reject(new Error("job-cancelled"))
        }
        const timer = setTimeout(() => {
          record.controller.signal.removeEventListener("abort", onAbort)
          resolve()
        }, delayMs)
        record.controller.signal.addEventListener("abort", onAbort, {
          once: true,
        })
        if (record.controller.signal.aborted) onAbort()
      })
    }
    if (record.controller.signal.aborted) {
      throw new Error("job-cancelled")
    }
    record.stage = "resolving"
    record.updatedAt = Date.now()
  }

  private async sendJobProgressMessage(
    record: OffscreenJobRecord,
    payload: UnsequencedProgressPayload
  ): Promise<void> {
    record.stage = payload.stage
    const sequence = this.nextJobSequence(record)
    await this.sendChapterProgressMessage({
      ...payload,
      jobId: record.request.jobId,
      attempt: record.request.attempt,
      sequence,
    })
  }

  private pruneTerminalJobs(): void {
    const terminalJobs = [...this.jobs.entries()]
      .filter(([, record]) => record.status !== "active")
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
    for (const [jobId] of terminalJobs.slice(8)) {
      this.jobs.delete(jobId)
    }
  }

  getCurrentJobState(): OffscreenJobState | null {
    const records = [...this.jobs.values()].sort((left, right) => {
      if (left.status === "active" && right.status !== "active") return -1
      if (right.status === "active" && left.status !== "active") return 1
      return right.updatedAt - left.updatedAt
    })
    const record = records[0]
    if (!record) return null
    return {
      jobId: record.request.jobId,
      attempt: record.request.attempt,
      taskId: record.request.taskId,
      chapterId: record.request.chapter.id,
      status: record.status,
      stage: record.stage,
      sequence: record.sequence,
      outcome: record.outcome,
    }
  }

  cancelJob(input: {
    jobId: string
    attempt: number
    taskId: string
    chapterId: string
  }): boolean {
    const record = this.jobs.get(input.jobId)
    if (
      !record ||
      record.request.attempt !== input.attempt ||
      record.request.taskId !== input.taskId ||
      record.request.chapter.id !== input.chapterId ||
      record.status !== "active"
    ) {
      return false
    }
    record.status = "canceled"
    record.updatedAt = Date.now()
    this.stopJobHeartbeat(record)
    record.controller.abort("User cancelled")
    this.clearPendingChapterProgress(`${input.taskId}:${input.chapterId}`)
    return true
  }

  /**
   * Parse a fetched series page HTML in the offscreen document using the
   * integration's DOM-based series resolver.
   */
  public async parseSeriesHtml(
    request: OffscreenParseSeriesHtmlPayload
  ): Promise<OffscreenParseSeriesHtmlResponse> {
    const integrationInfo = siteIntegrationRegistry.findById(
      request.siteIntegrationId
    )
    if (!integrationInfo?.integration?.offscreen?.series?.resolveSeriesData) {
      return {
        success: false,
        error: `Site integration ${request.siteIntegrationId} does not implement offscreen series resolution`,
      }
    }

    const document = new DOMParser().parseFromString(request.html, "text/html")
    if (!document.body || document.body.childElementCount === 0) {
      return {
        success: false,
        error: "Parsed series HTML document is empty",
      }
    }

    const result =
      await integrationInfo.integration.offscreen.series.resolveSeriesData({
        seriesUrl: request.seriesUrl,
        html: request.html,
        document,
        language: request.language,
      })
    return {
      success: true,
      seriesMetadata: result.seriesMetadata,
      chapterList: result.chapterList,
      metadataError: result.metadataError,
      chapterListError: result.chapterListError,
    }
  }

  // Resolve chapter assets, then dispatch to the specific archive or non-archive flow.
  private async processChapterStreaming(
    opts: ProcessChapterStreamingOptions,
    job: JobExecutionContext
  ): Promise<ChapterOutcome> {
    const { chapter, abortSignal, onProgress } = opts
    const normalizeSettings: ArchiveNormalizationSettings = {
      normalizeImageFilenames: opts.normalizeImageFilenames ?? true,
      imagePaddingDigits: opts.imagePaddingDigits ?? "auto",
    }

    try {
      const integrationId = job.integrationId

      const integrationInfo = siteIntegrationRegistry.findById(integrationId)
      if (!integrationInfo || !integrationInfo.integration?.offscreen) {
        throw new Error(`No site integration found for ID: ${integrationId}`)
      }

      const OffscreenIntegration = integrationInfo.integration.offscreen
      const downloadImage: ChapterDownloadImageFn = (url, options) =>
        OffscreenIntegration.chapter.downloadImage(url, options)

      await onProgress(5, "fetching")
      if (abortSignal?.aborted) throw new Error("job-cancelled")

      const chapterRetries = job.retries.chapter
      const resolveWithTimeout = async () => {
        const resolvePromise = OffscreenIntegration.chapter.resolveImageUrls!(
          { id: chapter.id, url: chapter.url },
          opts.integrationContext,
          opts.settingsSnapshot ? { ...opts.settingsSnapshot } : undefined
        )
        return awaitWithTimeoutAndSignal(
          resolvePromise,
          DEFAULT_FETCH_TIMEOUT_MS,
          abortSignal
        )
      }

      // Report each resolve/fetch retry as meaningful progress. The dedicated
      // heartbeat renews the durable job lease independently, while this event
      // keeps the visible stage accurate for long retry sequences.
      const resolveWithProgress = async () => {
        await onProgress(10, "parsing")
        return resolveWithTimeout()
      }

      const urls = OffscreenIntegration.chapter.resolveImageUrls
        ? await (job.handlesOwnRetries
            ? resolveWithProgress()
            : withRetries(
                resolveWithProgress,
                chapterRetries,
                1000,
                undefined,
                abortSignal
              ))
        : await (async () => {
            const parseImageUrlsFromHtml =
              OffscreenIntegration.chapter.parseImageUrlsFromHtml
            if (!parseImageUrlsFromHtml) {
              throw new Error(
                `Site integration ${integrationId} does not implement resolveImageUrls or parseImageUrlsFromHtml`
              )
            }

            let html: string
            let htmlFetchErrorMessage: string | undefined
            try {
              const fetchHtmlWithProgress = async () => {
                await onProgress(10, "parsing")
                return fetchChapterHtml(
                  chapter.url,
                  DEFAULT_FETCH_TIMEOUT_MS,
                  integrationId,
                  opts.settingsSnapshot?.rateLimitSettings?.chapter,
                  abortSignal
                )
              }
              html = await withRetries(
                fetchHtmlWithProgress,
                chapterRetries,
                1000,
                undefined,
                abortSignal
              )
            } catch (error) {
              htmlFetchErrorMessage =
                error instanceof Error
                  ? error.message
                  : typeof error === "string"
                    ? error
                    : undefined
              html = ""
            }

            const raw = await parseImageUrlsFromHtml({
              chapterId: chapter.id,
              chapterUrl: chapter.url,
              chapterHtml: html,
            })
            if (raw.length === 0 && htmlFetchErrorMessage) {
              throw new Error(
                `Failed to fetch chapter HTML: ${htmlFetchErrorMessage}`
              )
            }

            return OffscreenIntegration.chapter.processImageUrls(raw, chapter)
          })()

      if (urls.length === 0) {
        throw new Error("No images found")
      }

      await onProgress(10, "ready", { current: 0, total: urls.length })

      const chapterProcessingRuntime: ChapterProcessingRuntime = {
        withImageRetries: <T>(
          fn: () => Promise<T>,
          hooks?: {
            onAttemptStart?: (attempt: number) => void | Promise<void>
          }
        ) => this.withImageRetries(job, fn, hooks, abortSignal),
        resolveWritableDownloadRoot: (input) =>
          this.resolveWritableDownloadRoot(input),
        requestBrowserBlobDownload: (input) =>
          this.requestBrowserBlobDownload(input),
        getMemoryStats: () => this.getMemoryStats(),
      }

      if (opts.format === "none") {
        return await processNoneFormatChapter(chapterProcessingRuntime, {
          opts: { ...opts, format: "none" },
          urls,
          integrationId,
          downloadImage,
          normalizeSettings,
        })
      }

      return await processArchiveFormatChapter(chapterProcessingRuntime, {
        opts: { ...opts, format: opts.format },
        urls,
        integrationId,
        downloadImage,
        normalizeSettings,
      })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Unknown error"
      if (
        typeof message === "string" &&
        message.toLowerCase().includes("job-cancelled")
      ) {
        logger.debug("processChapterStreaming cancelled")
      } else {
        logger.error("processChapterStreaming failed:", error)
      }
      return {
        status: "failed",
        errorMessage: message,
        errorCategory: classifyOffscreenErrorCategory(error),
      }
    }
  }

  private async sendChapterProgressMessage(
    payload: OffscreenDownloadProgressMessage["payload"],
    throwOnFailure = false
  ): Promise<void> {
    try {
      const chapterKey = `${payload.taskId}:${payload.chapterId}`
      if (payload.status !== "downloading") {
        // Flush any pending throttled progress before sending the terminal update.
        // This ensures the last downloading-state progress is not lost when the
        // terminal status arrives within the throttle window.
        await this.flushPendingChapterProgress(chapterKey)
        await this.dispatchChapterProgressMessage(chapterKey, payload)
        this.chapterProgressLastSentAt.delete(chapterKey)
        return
      }

      const previousSentAt = this.chapterProgressLastSentAt.get(chapterKey) ?? 0
      const elapsedMs = Date.now() - previousSentAt
      const throttleWindowMs = 250
      if (previousSentAt > 0 && elapsedMs < throttleWindowMs) {
        this.schedulePendingChapterProgress(
          chapterKey,
          payload,
          throttleWindowMs - elapsedMs
        )
        return
      }

      this.clearPendingChapterProgress(chapterKey)
      await this.dispatchChapterProgressMessage(chapterKey, payload)
    } catch (error) {
      logger.error("❌ Failed to send chapter progress update message:", error)
      if (throwOnFailure) throw error
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

  private clearPendingTaskProgress(taskId: string): void {
    const taskPrefix = `${taskId}:`
    for (const chapterKey of this.pendingChapterProgress.keys()) {
      if (chapterKey.startsWith(taskPrefix)) {
        this.clearPendingChapterProgress(chapterKey)
      }
    }
  }

  /**
   * Flush any pending throttled chapter progress by sending it immediately,
   * then clearing the pending entry. Used before terminal progress so the
   * last downloading-state update is not lost.
   */
  private async flushPendingChapterProgress(chapterKey: string): Promise<void> {
    const pendingEntry = this.pendingChapterProgress.get(chapterKey)
    if (!pendingEntry) {
      return
    }

    clearTimeout(pendingEntry.timerId)
    this.pendingChapterProgress.delete(chapterKey)
    await this.dispatchChapterProgressMessage(chapterKey, pendingEntry.payload)
  }

  private schedulePendingChapterProgress(
    chapterKey: string,
    payload: OffscreenDownloadProgressMessage["payload"],
    delayMs: number
  ): void {
    const existingEntry = this.pendingChapterProgress.get(chapterKey)
    if (existingEntry) {
      clearTimeout(existingEntry.timerId)
    }

    const timerId = setTimeout(
      () => {
        const pendingEntry = this.pendingChapterProgress.get(chapterKey)
        if (!pendingEntry || pendingEntry.timerId !== timerId) {
          return
        }

        this.pendingChapterProgress.delete(chapterKey)
        void this.dispatchChapterProgressMessage(
          chapterKey,
          pendingEntry.payload
        ).catch((error) => {
          logger.error(
            "❌ Failed to flush throttled chapter progress update:",
            error
          )
        })
      },
      Math.max(0, delayMs)
    )

    this.pendingChapterProgress.set(chapterKey, {
      payload,
      timerId,
    })
  }

  private async dispatchChapterProgressMessage(
    chapterKey: string,
    payload: OffscreenDownloadProgressMessage["payload"]
  ): Promise<void> {
    this.chapterProgressLastSentAt.set(chapterKey, Date.now())
    try {
      await this.sendMessageWithRetry(
        {
          type: "OFFSCREEN_DOWNLOAD_PROGRESS",
          payload,
        },
        3,
        250
      )
    } catch (error) {
      this.chapterProgressLastSentAt.delete(chapterKey)
      throw error
    }
    logger.debug(
      `📊 Sent chapter progress update ${payload.taskId}/${payload.chapterId}:`,
      payload
    )
  }

  // Runtime message retry with small backoff to tolerate transient SW wakeups.
  // Only retries on connection-level errors (port closed, SW restarting).
  // Does NOT retry on "receiving end does not exist" (permanent — no listener registered).
  private async sendMessageWithRetry<
    T extends import("@/src/types/extension-messages").ExtensionMessage,
    R,
  >(msg: T, attempts = 3, baseDelayMs = 250): Promise<R> {
    let lastError: Error | undefined
    for (let i = 0; i < attempts; i++) {
      try {
        const response = await chrome.runtime.sendMessage<T, R>(msg)
        if (
          response &&
          typeof response === "object" &&
          "success" in response &&
          (response as { success?: unknown }).success === false
        ) {
          const errorMessage =
            "error" in response &&
            typeof (response as { error?: unknown }).error === "string"
              ? (response as { error: string }).error
              : "message receiver rejected the request"
          throw new Error(errorMessage)
        }
        return response
      } catch (e) {
        lastError =
          e instanceof Error ? e : new Error("sendMessage failed", { cause: e })
        const message = lastError.message.toLowerCase()
        const isTransient =
          message.includes("port closed") ||
          message.includes("message port closed")
        if (!isTransient || i === attempts - 1) {
          throw lastError
        }
        const delay = baseDelayMs * Math.pow(2, i)
        await new Promise((r) => setTimeout(r, delay))
      }
    }
    throw lastError ?? new Error("sendMessage failed after retries")
  }

  getActiveJobCount(): number {
    return [...this.jobs.values()].filter((job) => job.status === "active")
      .length
  }

  getActiveTaskIds(): string[] {
    return [
      ...new Set(
        [...this.jobs.values()]
          .filter((job) => job.status === "active")
          .map((job) => job.request.taskId)
      ),
    ].sort((left, right) => left.localeCompare(right))
  }

  cancelTask(taskId: string): boolean {
    let canceled = false
    for (const job of this.jobs.values()) {
      if (job.request.taskId !== taskId || job.status !== "active") continue
      canceled =
        this.cancelJob({
          jobId: job.request.jobId,
          attempt: job.request.attempt,
          taskId,
          chapterId: job.request.chapter.id,
        }) || canceled
    }
    if (canceled) return true

    const taskControllerEntry = this.activeTaskControllers.get(taskId)
    if (!taskControllerEntry) {
      return false
    }

    try {
      taskControllerEntry.controller.abort("User cancelled")
    } catch (error) {
      logger.debug("Failed to abort task controller (non-fatal):", error)
    }
    this.clearPendingTaskProgress(taskId)

    // Proactively remove the entry so it doesn't linger if the
    // processDownloadChapter promise takes time to settle after abort.
    this.activeTaskControllers.delete(taskId)

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

document.addEventListener("DOMContentLoaded", () => {
  try {
    statusController.initializeDom()
  } catch (error) {
    statusController.reportBootstrapError(error)
  }
})

// NOTE: Offscreen documents can use DOM/web APIs, but from the Chrome extension
// API surface they can ONLY use chrome.runtime, NOT chrome.storage.
// The previous chrome.storage.session listener caused TypeError because chrome.storage is undefined in offscreen context
// All work dispatch happens via chrome.runtime.sendMessage handled in processMessage() above

logger.debug("✅ Offscreen document script loaded")
