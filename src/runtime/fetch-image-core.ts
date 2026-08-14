import {
  HARD_TIMEOUT_MS,
  STALL_TIMEOUT_MS,
  MAX_IMAGE_BYTES,
} from "@/src/constants/timeouts"
import { normalizeAllowedImageMimeType } from "@/src/shared/site-integration-utils"
import { NonRetryableDownloadError } from "@/src/shared/download-contract"
import {
  allowsDeterministicE2eRedirect,
  shouldAcceptDeterministicE2eMockResponse,
} from "./deterministic-e2e-redirect"
import type {
  OffscreenLiveResourceLedger,
  OffscreenLiveResourceLease,
} from "./offscreen-live-resource-ledger"
import { fetchSharedResource } from "@/src/site-integrations/http-client"

export interface FetchImageWithStallDetectionCoreOptions {
  signal?: AbortSignal
  init?: RequestInit
  stallTimeoutMs?: number
  hardTimeoutMs?: number
  fetcher?: (imageUrl: string, init: RequestInit) => Promise<Response>
  createHttpError?: (response: Response) => Error
  assertUrlAllowed?: (url: string) => void
  onResponse?: (response: Response) => void | Promise<void>
  onBytesReceived?: (bytesReceived: number) => void | Promise<void>
  liveResourceLedger?: OffscreenLiveResourceLedger
}

export type FetchedImageData = {
  data: ArrayBuffer
  mimeType: string
  liveResourceLease?: OffscreenLiveResourceLease
}

/**
 * Fetches an image while enforcing body-progress stalls and a hard total request
 * timeout, with MIME validation.
 */
export async function fetchImageWithStallDetection(
  imageUrl: string,
  options: FetchImageWithStallDetectionCoreOptions = {}
): Promise<FetchedImageData> {
  let liveResourceLease = options.liveResourceLedger
    ? await options.liveResourceLedger.acquire(
        "image fetch chunks and merged buffer",
        2 * MAX_IMAGE_BYTES,
        options.signal
      )
    : undefined
  const stallTimeoutMs = options.stallTimeoutMs ?? STALL_TIMEOUT_MS
  const hardTimeoutMs = options.hardTimeoutMs ?? HARD_TIMEOUT_MS

  const controller = new AbortController()
  const onAbort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener("abort", onAbort, { once: true })
  if (options.signal?.aborted) {
    controller.abort(options.signal.reason)
  }

  const hardTimeoutId = setTimeout(() => {
    controller.abort(
      new Error(`Image download hard timeout after ${hardTimeoutMs}ms`)
    )
  }, hardTimeoutMs)

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let shouldCancelReader = false
  let readerCancelReason: unknown
  let response: Response | null = null
  let bodyFullyConsumed = false

  const retainFetchedBuffer = (
    data: ArrayBuffer,
    mimeType: string
  ): FetchedImageData => {
    if (!liveResourceLease) return { data, mimeType }
    liveResourceLease.resize(data.byteLength)
    const retainedLease = liveResourceLease.transfer("retained encoded image")
    liveResourceLease = undefined
    return { data, mimeType, liveResourceLease: retainedLease }
  }

  try {
    options.assertUrlAllowed?.(imageUrl)
    const requestInit: RequestInit = {
      // Public provider APIs/CDNs are the common case. Integrations that
      // deliberately depend on a browser session must opt in at the call site.
      credentials: "omit",
      ...options.init,
      // Validation after an automatically followed redirect is too late: the
      // browser has already contacted the target and may have sent credentials.
      // Integration requests therefore fail closed on every redirect.
      redirect: allowsDeterministicE2eRedirect ? "follow" : "error",
      signal: controller.signal,
    }
    const fetcher = options.fetcher ?? fetchSharedResource
    response = await withAbortSignal(fetcher(imageUrl, requestInit), controller)
    if (!shouldAcceptDeterministicE2eMockResponse(response.url)) {
      options.assertUrlAllowed?.(response.url || imageUrl)
    }

    if (!response.ok) {
      throw (
        options.createHttpError?.(response) ??
        Object.assign(
          new Error(`HTTP ${response.status}: ${response.statusText}`),
          { status: response.status }
        )
      )
    }

    const mimeType = normalizeAllowedImageMimeType(
      response.headers.get("content-type")
    )
    await options.onResponse?.(response)

    if (!response.body) {
      const data = await withStallTimeout(
        response.arrayBuffer(),
        stallTimeoutMs,
        `Image body stalled after ${stallTimeoutMs}ms`,
        controller
      )
      await options.onBytesReceived?.(data.byteLength)
      if (data.byteLength > MAX_IMAGE_BYTES) {
        const error = new NonRetryableDownloadError(
          `Image size exceeds ${MAX_IMAGE_BYTES} byte limit (got ${data.byteLength})`
        )
        controller.abort(error)
        throw error
      }
      bodyFullyConsumed = true
      return retainFetchedBuffer(data, mimeType)
    }

    reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let totalBytes = 0

    while (true) {
      let stallTimeoutId: ReturnType<typeof setTimeout> | null = null

      try {
        const readResult = await withStallTimeout(
          reader.read(),
          stallTimeoutMs,
          `Image download stalled after ${stallTimeoutMs}ms`,
          controller,
          (timeoutId) => {
            stallTimeoutId = timeoutId
          }
        )

        if (stallTimeoutId) {
          clearTimeout(stallTimeoutId)
        }

        if (readResult.done) {
          bodyFullyConsumed = true
          break
        }

        if (readResult.value && readResult.value.byteLength > 0) {
          const nextTotalBytes = totalBytes + readResult.value.byteLength
          if (nextTotalBytes > MAX_IMAGE_BYTES) {
            const error = new NonRetryableDownloadError(
              `Image size exceeds ${MAX_IMAGE_BYTES} byte limit (got ${nextTotalBytes})`
            )
            controller.abort(error)
            throw error
          }
          try {
            await options.onBytesReceived?.(nextTotalBytes)
          } catch (error) {
            controller.abort(error)
            throw error
          }
          chunks.push(readResult.value)
          totalBytes = nextTotalBytes
        }
      } catch (error) {
        if (stallTimeoutId) {
          clearTimeout(stallTimeoutId)
        }
        shouldCancelReader = true
        readerCancelReason = error
        throw error
      }
    }

    const merged = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }

    return retainFetchedBuffer(merged.buffer, mimeType)
  } finally {
    clearTimeout(hardTimeoutId)
    options.signal?.removeEventListener("abort", onAbort)
    if (reader && shouldCancelReader) {
      void reader.cancel(readerCancelReason).catch(() => undefined)
    } else if (!reader && response?.body && !bodyFullyConsumed) {
      void response.body.cancel(readerCancelReason).catch(() => undefined)
    }
    try {
      reader?.releaseLock()
    } catch {
      // no-op
    }
    liveResourceLease?.release()
  }
}

async function withAbortSignal<T>(
  promise: Promise<T>,
  controller: AbortController
): Promise<T> {
  let onAbort: (() => void) | null = null

  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        if (controller.signal.aborted) {
          reject(toAbortError(controller.signal))
          return
        }

        onAbort = () => reject(toAbortError(controller.signal))
        controller.signal.addEventListener("abort", onAbort, { once: true })
      }),
    ])
  } finally {
    if (onAbort) {
      controller.signal.removeEventListener("abort", onAbort)
    }
  }
}

async function withStallTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  controller: AbortController,
  onTimeoutScheduled?: (timeoutId: ReturnType<typeof setTimeout>) => void
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let onAbort: (() => void) | null = null

  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        if (controller.signal.aborted) {
          reject(toAbortError(controller.signal))
          return
        }

        onAbort = () => reject(toAbortError(controller.signal))
        controller.signal.addEventListener("abort", onAbort, { once: true })

        timeoutId = setTimeout(() => {
          const error = new Error(message)
          controller.abort(error)
          reject(error)
        }, timeoutMs)
        onTimeoutScheduled?.(timeoutId)
      }),
    ])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    if (onAbort) {
      controller.signal.removeEventListener("abort", onAbort)
    }
  }
}

function toAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("aborted")
}
