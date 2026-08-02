/**
 * Image Processor - Chapter Download and Image Fetching
 *
 * Handles chapter HTML fetching, image URL extraction, and image downloading
 * using site integration architecture with retry logic and rate limiting.
 */

import { scheduleForIntegrationScope } from "@/src/runtime/rate-limit"
import type { EffectivePolicy } from "@/src/runtime/rate-limit"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"
import {
  allowsDeterministicE2eRedirect,
  shouldAcceptDeterministicE2eMockResponse,
} from "@/src/runtime/deterministic-e2e-redirect"
import logger from "@/src/runtime/logger"
import {
  assertIntegrationRequestUrl,
  assertIntegrationResponseUrl,
  createIntegrationUrlAssertion,
} from "@/src/site-integrations/request-policy"

export { fetchImageWithStallDetection }

/**
 * Promise queue for managing concurrent operations
 */
class PromiseQueue {
  private maxConcurrent: number
  private running: number
  private queue: Array<{
    task: () => Promise<unknown>
    resolve: (value: unknown) => void
    reject: (reason?: unknown) => void
  }>

  constructor(maxConcurrent: number = 8) {
    this.maxConcurrent = maxConcurrent
    this.running = 0
    this.queue = []
  }

  add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        task,
        resolve: (v: unknown) => resolve(v as T),
        reject: (r?: unknown) =>
          reject(r instanceof Error ? r : new Error(String(r))),
      })
      this._runNext()
    })
  }

  cancelPending(reason: unknown = new Error("queue-cancelled")): number {
    const pending = this.queue.splice(0, this.queue.length)
    for (const item of pending) {
      item.reject(reason)
    }
    return pending.length
  }

  private _runNext(): void {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return
    }

    const { task, resolve, reject } = this.queue.shift()!
    this.running++

    const promise = task()
    promise.then(resolve, reject).finally(() => {
      this.running--
      this._runNext()
    })
  }
}

/**
 * Fetch chapter HTML with timeout and retry.
 *
 * HTML bytes are decoded strictly from the response's declared charset metadata
 * (BOM, Content-Type, or <meta charset>). Undeclared or mismatched encodings are
 * treated as hard failures instead of guessing fallback decoders.
 */
async function fetchChapterHtml(
  chapterUrl: string,
  timeoutMs: number,
  integrationId: string,
  rateLimitPolicy?: EffectivePolicy,
  signal?: AbortSignal
): Promise<string> {
  const controller = new AbortController()
  const onAbort = () => controller.abort(new Error("job-cancelled"))
  signal?.addEventListener("abort", onAbort, { once: true })
  if (signal?.aborted) onAbort()
  const timer = setTimeout(
    () => controller.abort(new Error("fetch-html-timeout")),
    timeoutMs
  )
  try {
    assertIntegrationRequestUrl(integrationId, chapterUrl)
    const fetchFn = () =>
      fetch(chapterUrl, {
        signal: controller.signal,
        credentials: "omit",
        redirect: allowsDeterministicE2eRedirect ? "follow" : "error",
      })
    const response = await awaitWithAbortSignal(
      scheduleForIntegrationScope(
        integrationId,
        "chapter",
        fetchFn,
        rateLimitPolicy
      ),
      controller.signal
    )
    if (!shouldAcceptDeterministicE2eMockResponse(response.url)) {
      assertIntegrationResponseUrl(integrationId, chapterUrl, response.url)
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const decoded = await awaitWithAbortSignal(
      decodeHtmlResponse(response),
      controller.signal
    )
    const html = decoded.html
    logger.debug(
      `📄 Fetched HTML for ${chapterUrl} (${html.length} chars, encoding=${decoded.encoding}, source=${decoded.source})`
    )

    return html
  } catch (error) {
    logger.error(`❌ Failed to fetch HTML: ${chapterUrl}`, error)
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", onAbort)
  }
}

/**
 * Retry wrapper with exponential backoff
 */
function getHttpStatusFromError(error: unknown): number | null {
  if (!(error instanceof Error)) return null
  const match = error.message.match(/HTTP\s+(\d{3})/)
  if (!match) return null
  const code = Number.parseInt(match[1], 10)
  return Number.isNaN(code) ? null : code
}

function isCancellationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  if (error.name === "AbortError") {
    return true
  }

  const message = error.message.toLowerCase()
  return message === "aborted" || message.includes("job-cancelled")
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("job-cancelled")
}

function awaitWithAbortSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason instanceof Error
        ? signal.reason
        : new Error("job-cancelled")
    )
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort)
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("job-cancelled")
      )
    }
    signal.addEventListener("abort", onAbort, { once: true })
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(
          error instanceof Error
            ? error
            : new Error("Aborted operation failed", { cause: error })
        )
      }
    )
  })
}

function waitForRetryDelay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  if (ms <= 0) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timeoutId)
      signal?.removeEventListener("abort", onAbort)
      reject(new Error("job-cancelled"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

async function withRetries<T>(
  fn: () => Promise<T>,
  retries: number,
  baseDelayMs = 1000,
  hooks?: { onAttemptStart?: (attempt: number) => void | Promise<void> },
  signal?: AbortSignal
): Promise<T> {
  const maxAttempts = Math.max(0, Math.trunc(retries)) + 1

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      throwIfAborted(signal)
      await hooks?.onAttemptStart?.(attempt)
      return await fn()
    } catch (error) {
      if (isCancellationError(error)) {
        throw error
      }
      if (attempt === maxAttempts) throw error
      const status = getHttpStatusFromError(error)
      if (status !== null && status >= 400 && status < 500 && status !== 429) {
        throw error
      }
      const delay = baseDelayMs * Math.pow(3, attempt - 1)
      await waitForRetryDelay(delay, signal)
    }
  }
  throw new Error("Retry failed") // Never reached
}

/**
 * Download series cover image with rate limiting
 * Cover image inclusion
 *
 * @param coverUrl - URL of the cover image
 * @param integrationId - Site integration ID for rate limiting scope
 * @param retries - Number of retry attempts
 * @returns Cover image data with extension, or null if unavailable
 */
export async function downloadCoverImage(
  coverUrl: string | undefined,
  integrationId: string | undefined,
  fetchTimeoutMs: number,
  retries: number = 3
): Promise<{ data: ArrayBuffer; mimeType: string; extension: string } | null> {
  if (!coverUrl) {
    logger.debug("[COVER] No cover URL provided")
    return null
  }

  try {
    logger.debug("[COVER] Downloading:", coverUrl)

    const { data, mimeType } = await withRetries(
      () =>
        fetchImageWithStallDetection(coverUrl, {
          integrationId,
          stallTimeoutMs: fetchTimeoutMs,
          hardTimeoutMs: fetchTimeoutMs,
          assertUrlAllowed: integrationId
            ? createIntegrationUrlAssertion(integrationId)
            : undefined,
        }),
      retries,
      300 // Base delay for retries
    )

    const subtype = mimeType.split("/")[1]
    let extension: string
    if (subtype === "jpeg") extension = "jpeg"
    else if (subtype === "jpg") extension = "jpg"
    else extension = subtype || "jpg"

    logger.debug(
      `[COVER] Downloaded successfully: ${data.byteLength} bytes, type: ${mimeType}`
    )
    return { data, mimeType, extension }
  } catch (error) {
    logger.error("[COVER] Download error:", error)
    return null // Continue without cover
  }
}

export { PromiseQueue, withRetries, fetchChapterHtml }
