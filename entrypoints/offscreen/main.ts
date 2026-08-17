/**
 * Offscreen document runtime for archive creation, image processing,
 * and background-assisted downloads.
 */

import type { Chapter } from "@/src/types/chapter"
import type {
  RuntimeMessageRequest,
  RuntimeMessageResponse,
} from "@/src/runtime/runtime-message-contracts"
import { withRetries } from "./image-processor"
import { offscreenSiteAdaptersById } from "@/src/runtime/generated/site-integration-offscreen-registry"
import { getDefinition, isEnabled } from "@/src/site-integrations/catalog"
import {
  initializeOffscreenSiteIntegrations,
  loadOffscreenSiteIntegrationEnablement,
} from "@/src/runtime/site-integration-offscreen-initialization"
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
import {
  RateLimitService,
  type RateLimitPolicySnapshot,
} from "@/src/runtime/rate-limit"
import {
  OffscreenSeriesResolver,
  type OffscreenParseSeriesHtmlPayload,
  type OffscreenParseSeriesHtmlResponse,
} from "./series-resolver"
import {
  OffscreenJobEventCoordinator,
  type OffscreenDownloadChapterPayload,
  type OffscreenJobRecord,
} from "./job-event-coordinator"
import { offscreenDispatchFingerprintMatches } from "@/src/runtime/offscreen-job-fingerprint"
import { NonRetryableDownloadError } from "@/src/shared/download-contract"
import { BrowserBlobLeaseRegistry } from "./browser-blob-lease-registry"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import type { OffscreenLiveResourceLease } from "@/src/runtime/offscreen-live-resource-ledger"
import { readSiteIntegrationDispatchContext } from "@/src/runtime/site-integration-dispatch-context-envelope"
import { parseChapterImagePlan } from "@/src/site-integrations/chapter-plan"
import type {
  OffscreenJobIncarnation,
  OffscreenJobOutcome,
  OffscreenJobState,
} from "@/src/runtime/offscreen-job-contracts"

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

type OffscreenDownloadChapterAck = Omit<
  Extract<
    RuntimeMessageResponse<"OFFSCREEN_DOWNLOAD_CHAPTER">,
    { success: true }
  >,
  "success"
>
type RevokeBlobUrlPayload = RuntimeMessageRequest<"REVOKE_BLOB_URL">["payload"]

function createSnapshotRateLimitService(
  settings: RateLimitPolicySnapshot
): RateLimitService {
  return new RateLimitService({
    resolveEffectivePolicy: (_integrationId, scope) =>
      Promise.resolve(settings[scope]),
  })
}

function awaitWithTimeoutAndSignal<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
  onTimeout?: () => void
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
      () =>
        finish(() => {
          onTimeout?.()
          reject(new Error("resolveChapterPlan timeout"))
        }),
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
  private readonly activeTaskControllers = new Map<
    string,
    TaskControllerEntry
  >()
  private readonly jobs = new Map<string, OffscreenJobRecord>()
  private readonly browserBlobs: BrowserBlobLeaseRegistry
  private readonly seriesResolver: OffscreenSeriesResolver
  private readonly jobEvents: OffscreenJobEventCoordinator

  constructor(
    readonly documentInstanceId: string = crypto.randomUUID(),
    private readonly liveResourceLedger = new OffscreenLiveResourceLedger()
  ) {
    this.browserBlobs = new BrowserBlobLeaseRegistry(
      undefined,
      undefined,
      liveResourceLedger
    )
    this.seriesResolver = new OffscreenSeriesResolver((settings) =>
      createSnapshotRateLimitService(settings)
    )
    this.jobEvents = new OffscreenJobEventCoordinator(this.documentInstanceId, {
      pruneTerminalJobs: () => this.pruneTerminalJobs(),
    })
  }

  async initialize(): Promise<void> {
    try {
      logger.debug("🔧 Initializing offscreen worker...")

      logger.debug("🔌 Loading site integration enablement in offscreen...")
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

  private async requestBrowserBlobDownload(input: {
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
    signal: AbortSignal
    resourceLease: OffscreenLiveResourceLease
  }): ReturnType<typeof requestBrowserBlobDownload> {
    if (input.signal.aborted) {
      throw new Error("job-cancelled")
    }
    const record = this.jobs.get(input.jobId)
    if (
      !record ||
      record.status !== "active" ||
      record.request.attempt !== input.attempt ||
      record.request.taskId !== input.taskId ||
      record.request.chapter.id !== input.chapterId
    ) {
      throw new Error("Offscreen job authority is not current")
    }
    const identity = this.browserBlobs.retain({
      jobId: input.jobId,
      attempt: input.attempt,
      taskId: input.taskId,
      chapterId: input.chapterId,
      fingerprint: record.request.fingerprint,
      documentInstanceId: this.documentInstanceId,
      outputId: input.outputId,
      blob: input.blob,
      resourceLease: input.resourceLease,
    })

    const response = await requestBrowserBlobDownload({
      ...input,
      fingerprint: record.request.fingerprint,
      documentInstanceId: this.documentInstanceId,
      fileUrl: identity.blobUrl,
    })
    if (response.success !== true) {
      // A runtime/handler failure does not prove that the durable background
      // handoff failed. Keep the Blob owned here so reconciliation can still
      // resolve an already-prepared output.
      throw new Error(response.error)
    }
    if (
      response.disposition === "not_persisted" &&
      !this.revokeBlobUrl(identity)
    ) {
      throw new Error("Blob URL ownership changed before rejection cleanup")
    }
    return response
  }

  revokeBlobUrl(input: RevokeBlobUrlPayload): boolean {
    return this.browserBlobs.revoke(input)
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
    const integrationMeta = getDefinition(siteIntegrationId)
    return {
      integrationId: siteIntegrationId,
      retries,
      handlesOwnRetries: integrationMeta?.retryOwner === "provider",
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

  public async processDownloadChapter(
    request: OffscreenDownloadChapterPayload
  ): Promise<OffscreenDownloadChapterAck> {
    const integrationContext = readSiteIntegrationDispatchContext(
      request.book.siteIntegrationId,
      request.integrationContext
    )
    if (!(await offscreenDispatchFingerprintMatches(request))) {
      throw new Error("Offscreen dispatch fingerprint mismatch")
    }
    const existing = this.jobs.get(request.jobId)
    if (existing) {
      if (
        existing.request.attempt !== request.attempt ||
        existing.request.taskId !== request.taskId ||
        existing.request.chapter.id !== request.chapter.id ||
        existing.request.fingerprint !== request.fingerprint
      ) {
        throw new Error("Job identity collision")
      }
      return this.createDispatchAck(existing)
    }

    for (const job of this.jobs.values()) {
      if (
        job.request.taskId !== request.taskId ||
        job.request.chapter.id !== request.chapter.id
      ) {
        continue
      }
      if (job.request.attempt > request.attempt) {
        throw new Error("Stale chapter dispatch attempt")
      }
      if (job.request.attempt === request.attempt) {
        throw new Error("Chapter dispatch identity collision")
      }
      if (job.status === "active") {
        throw new Error("Previous chapter dispatch is still active")
      }
    }

    const taskControllerEntry = this.acquireTaskController(request.taskId)
    const record: OffscreenJobRecord = {
      request,
      integrationContext,
      controller: taskControllerEntry.controller,
      stage: "dispatching",
      sequence: 0,
      status: "active",
      promise: Promise.resolve({
        status: "failed" as const,
        outputsRequested: 0,
        outputsFailedBeforeHandoff: 0,
        outputsCommitted: 0,
      }),
      heartbeatInFlight: false,
      eventTail: Promise.resolve(),
      updatedAt: Date.now(),
    }
    this.jobs.set(request.jobId, record)
    record.promise = new Promise<void>((resolve) =>
      setTimeout(resolve, 0)
    ).then(() => this.executeDownloadChapter(record, taskControllerEntry))
    void record.promise.catch((error) => {
      logger.error("Offscreen chapter execution failed", error)
    })
    return this.createDispatchAck(record)
  }

  private createDispatchAck(
    record: OffscreenJobRecord
  ): OffscreenDownloadChapterAck {
    return {
      accepted: true,
      ...this.jobIncarnation(record),
    }
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
      if (record.status !== "active" || record.controller.signal.aborted) {
        return (
          record.outcome ?? {
            status: "failed",
            errorMessage: "job-cancelled",
            outputsRequested: 0,
            outputsFailedBeforeHandoff: 0,
            outputsCommitted: 0,
          }
        )
      }
      await this.sendJobAccepted(record)
      this.startJobHeartbeat(record)
      await this.waitForNotBefore(record)

      const currentEnablement = await loadOffscreenSiteIntegrationEnablement()
      if (!isEnabled(request.book.siteIntegrationId, currentEnablement)) {
        throw new NonRetryableDownloadError(
          `Site integration ${request.book.siteIntegrationId} is disabled`
        )
      }

      const snapshot = readProcessDownloadChapterSettingsSnapshot(
        request.settingsSnapshot
      )
      const rateLimitService = createSnapshotRateLimitService(
        snapshot.rateLimitSettings
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
        integrationContext: record.integrationContext,
        rateLimitSettings: snapshot.rateLimitSettings,
        rateLimitService,
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
        liveResourceLedger: this.liveResourceLedger,
      })

      const streamingOptions = createProcessChapterStreamingOptions({
        request,
        integrationContext: record.integrationContext,
        snapshot,
        chapter: chapterForProcessing,
        abortSignal: taskControllerEntry.controller.signal,
        onProgress: progressHandlers.onProgress,
        onArchiveProgress: progressHandlers.onArchiveProgress,
        coverImage,
      })
      const outcome = await this.processChapterStreaming(
        streamingOptions,
        job,
        rateLimitService
      )

      if (taskControllerEntry.controller.signal.aborted) {
        record.status = "canceled"
        record.outcome = outcome
        record.updatedAt = Date.now()
        return outcome
      }

      releaseTaskControllerOnce()
      record.status = "terminal"
      record.stage = "saving"
      record.outcome = outcome
      record.updatedAt = Date.now()
      await this.sendJobTerminal(record, outcome)
      this.pruneTerminalJobs()
      return outcome
    } catch (error) {
      const outcome: ChapterOutcome = {
        status: "failed",
        errorMessage:
          error instanceof Error ? error.message : "Failed to process chapter",
        errorCategory: classifyOffscreenErrorCategory(error),
        outputsRequested: 0,
        outputsFailedBeforeHandoff: 0,
        outputsCommitted: 0,
      }
      record.status = taskControllerEntry.controller.signal.aborted
        ? "canceled"
        : "terminal"
      record.stage = "saving"
      record.outcome = outcome
      record.updatedAt = Date.now()
      if (!taskControllerEntry.controller.signal.aborted) {
        releaseTaskControllerOnce()
        await this.sendJobTerminal(record, outcome)
      }
      this.pruneTerminalJobs()
      return outcome
    } finally {
      this.stopJobHeartbeat(record)
      releaseTaskControllerOnce()
    }
  }

  private jobIncarnation(record: OffscreenJobRecord): OffscreenJobIncarnation {
    return this.jobEvents.jobIncarnation(record)
  }

  private toJobState(record: OffscreenJobRecord): OffscreenJobState {
    return this.jobEvents.toJobState(record)
  }

  private async sendJobAccepted(record: OffscreenJobRecord): Promise<void> {
    return await this.jobEvents.sendJobAccepted(record)
  }

  private startJobHeartbeat(record: OffscreenJobRecord): void {
    this.jobEvents.startJobHeartbeat(record)
  }

  private stopJobHeartbeat(record: OffscreenJobRecord): void {
    this.jobEvents.stopJobHeartbeat(record)
  }

  private async waitForNotBefore(record: OffscreenJobRecord): Promise<void> {
    return await this.jobEvents.waitForNotBefore(record)
  }

  private async sendJobProgressMessage(
    record: OffscreenJobRecord,
    payload: UnsequencedProgressPayload
  ): Promise<void> {
    return await this.jobEvents.sendJobProgressMessage(record, payload)
  }

  private async sendJobTerminal(
    record: OffscreenJobRecord,
    outcome: OffscreenJobOutcome
  ): Promise<void> {
    return await this.jobEvents.sendJobTerminal(record, outcome)
  }

  private pruneTerminalJobs(): void {
    const terminalJobs = [...this.jobs.entries()]
      .filter(([, record]) => record.status !== "active")
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
    for (const [jobId] of terminalJobs.slice(8)) {
      this.jobs.delete(jobId)
    }
  }

  getJobState(input: OffscreenJobIncarnation): OffscreenJobState | null {
    const record = this.jobs.get(input.jobId)
    if (
      !record ||
      record.request.attempt !== input.attempt ||
      record.request.taskId !== input.taskId ||
      record.request.chapter.id !== input.chapterId ||
      record.request.fingerprint !== input.fingerprint ||
      this.documentInstanceId !== input.documentInstanceId
    ) {
      return null
    }
    return this.toJobState(record)
  }

  cancelJob(
    input: OffscreenJobIncarnation
  ): Omit<
    Extract<RuntimeMessageResponse<"OFFSCREEN_CANCEL_JOB">, { success: true }>,
    "success"
  > {
    const record = this.jobs.get(input.jobId)
    if (!record) {
      return {
        canceled: false,
        ...input,
        status: "absent",
        lastSequence: 0,
      }
    }
    if (
      record.request.attempt !== input.attempt ||
      record.request.taskId !== input.taskId ||
      record.request.chapter.id !== input.chapterId ||
      record.request.fingerprint !== input.fingerprint ||
      this.documentInstanceId !== input.documentInstanceId
    ) {
      throw new Error("Job cancellation identity collision")
    }
    if (record.status !== "active") {
      return {
        canceled: record.status === "canceled",
        ...this.jobIncarnation(record),
        status: record.status,
        lastSequence: record.sequence,
      }
    }
    record.status = "canceled"
    record.updatedAt = Date.now()
    this.stopJobHeartbeat(record)
    record.controller.abort("User cancelled")
    this.pruneTerminalJobs()
    return {
      canceled: true,
      ...this.jobIncarnation(record),
      status: "canceled",
      lastSequence: record.sequence,
    }
  }

  /**
   * Parse a fetched series page HTML in the offscreen document using the
   * integration's DOM-based series resolver.
   */
  public async parseSeriesHtml(
    request: OffscreenParseSeriesHtmlPayload
  ): Promise<OffscreenParseSeriesHtmlResponse> {
    return await this.seriesResolver.parseSeriesHtml(request)
  }

  cancelSeriesHtml(requestId: string): boolean {
    return this.seriesResolver.cancelSeriesHtml(requestId)
  }

  // Resolve chapter assets, then dispatch to the specific archive or non-archive flow.
  private async processChapterStreaming(
    opts: ProcessChapterStreamingOptions,
    job: JobExecutionContext,
    rateLimitService: RateLimitService
  ): Promise<ChapterOutcome> {
    const { chapter, abortSignal, onProgress } = opts
    const normalizeSettings: ArchiveNormalizationSettings = {
      normalizeImageFilenames: opts.normalizeImageFilenames ?? true,
      imagePaddingDigits: opts.imagePaddingDigits ?? "auto",
    }

    try {
      const integrationId = job.integrationId

      const integration = offscreenSiteAdaptersById[integrationId]?.offscreen
      if (!integration) {
        throw new Error(`No site integration found for ID: ${integrationId}`)
      }

      const OffscreenIntegration = integration
      const downloadImage: ChapterDownloadImageFn = (url, options) =>
        OffscreenIntegration.chapter.downloadImage(url, {
          ...options,
          liveResourceLedger: this.liveResourceLedger,
        })

      await onProgress(5, "fetching")
      if (abortSignal?.aborted) throw new Error("job-cancelled")

      const chapterRetries = job.retries.chapter
      const resolveWithTimeout = async () => {
        const resolverController = new AbortController()
        const abortResolver = () =>
          resolverController.abort(abortSignal?.reason ?? "job-cancelled")
        abortSignal?.addEventListener("abort", abortResolver, { once: true })
        if (abortSignal?.aborted) abortResolver()
        try {
          const resolvePromise =
            OffscreenIntegration.chapter.resolveChapterPlan(
              { id: chapter.id, url: chapter.url },
              {
                dispatchContext: opts.integrationContext,
                runtime: {
                  chapterId: chapter.id,
                  rateLimitSettings: opts.settingsSnapshot.rateLimitSettings,
                  rateLimitService,
                },
                settings: { ...opts.settingsSnapshot },
                signal: resolverController.signal,
              }
            )
          return parseChapterImagePlan(
            await awaitWithTimeoutAndSignal(
              resolvePromise,
              DEFAULT_FETCH_TIMEOUT_MS,
              abortSignal,
              () => resolverController.abort("resolveChapterPlan timeout")
            )
          )
        } finally {
          abortSignal?.removeEventListener("abort", abortResolver)
        }
      }

      // Report each resolve/fetch retry as meaningful progress. The dedicated
      // heartbeat renews the durable job lease independently, while this event
      // keeps the visible stage accurate for long retry sequences.
      const resolveWithProgress = async () => {
        await onProgress(10, "parsing")
        return resolveWithTimeout()
      }

      const plan = job.handlesOwnRetries
        ? await resolveWithProgress()
        : await withRetries(
            resolveWithProgress,
            chapterRetries,
            1000,
            undefined,
            abortSignal
          )

      const urls = plan.imageUrls

      await onProgress(10, "ready", { current: 0, total: urls.length })

      const chapterProcessingRuntime: ChapterProcessingRuntime = {
        liveResourceLedger: this.liveResourceLedger,
        rateLimitService,
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
        outputsRequested: 0,
        outputsFailedBeforeHandoff: 0,
        outputsCommitted: 0,
      }
    } finally {
      opts.coverImage?.liveResourceLease?.release()
    }
  }

  getActiveJobCount(): number {
    return [...this.jobs.values()].filter((job) => job.status === "active")
      .length
  }

  getActiveSeriesResolutionCount(): number {
    return this.seriesResolver.getActiveCount()
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

logger.debug("✅ Offscreen document script loaded")
