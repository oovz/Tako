/**
 * Image Processor - Chapter Download and Image Fetching
 *
 * Handles chapter HTML fetching, image URL extraction, and image downloading
 * using site integration architecture with retry logic and rate limiting.
 */

import { isNonRetryableDownloadError } from "@/src/shared/download-contract"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"

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
 * Retry wrapper with exponential backoff
 */
function getHttpStatusFromError(error: unknown): number | null {
  if (!error || typeof error !== "object") return null
  const status = (error as { status?: unknown }).status
  return typeof status === "number" && Number.isInteger(status) ? status : null
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
      if (isNonRetryableDownloadError(error)) {
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

export { PromiseQueue, withRetries }
