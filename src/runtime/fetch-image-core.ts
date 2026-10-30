import {
  HARD_TIMEOUT_MS,
  STALL_TIMEOUT_MS,
  MAX_IMAGE_BYTES,
} from "@/src/constants/timeouts"
import {
  assertNonemptyImagePayload,
  normalizeAllowedImageMimeType,
} from "@/src/shared/site-integration-utils"
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
  /**
   * Reader endpoints may return encrypted images or a binary MIME type.
   * Opted-in integrations validate the resulting raster before output.
   */
  allowEncodedImageMimeType?: boolean
}

export type FetchedImageData = {
  data: ArrayBuffer
  mimeType: string
  liveResourceLease?: OffscreenLiveResourceLease
}

/** Fetch an image with bounded resources, body-progress stalls and a total timeout. */
export async function fetchImageWithStallDetection(
  imageUrl: string,
  options: FetchImageWithStallDetectionCoreOptions = {}
): Promise<FetchedImageData> {
  const lease = options.liveResourceLedger
    ? await options.liveResourceLedger.acquire(
        "image fetch chunks and merged buffer",
        2 * MAX_IMAGE_BYTES,
        options.signal
      )
    : undefined
  const lifetime = createImageRequestLifetime(options)
  try {
    const result = await fetchImageBody(imageUrl, options, lifetime.controller)
    assertNonemptyImagePayload(result.data)
    if (!lease) return result
    lease.resize(result.data.byteLength)
    return {
      ...result,
      liveResourceLease: lease.transfer("retained encoded image"),
    }
  } finally {
    lifetime.dispose()
    lease?.release()
  }
}

function createImageRequestLifetime(
  options: FetchImageWithStallDetectionCoreOptions
) {
  const controller = new AbortController()
  const onAbort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener("abort", onAbort, { once: true })
  if (options.signal?.aborted) controller.abort(options.signal.reason)
  const hardTimeoutMs = options.hardTimeoutMs ?? HARD_TIMEOUT_MS
  const hardTimeoutId = setTimeout(() => {
    controller.abort(
      new Error(`Image download hard timeout after ${hardTimeoutMs}ms`)
    )
  }, hardTimeoutMs)
  return {
    controller,
    dispose: () => {
      clearTimeout(hardTimeoutId)
      options.signal?.removeEventListener("abort", onAbort)
    },
  }
}

async function fetchImageResponse(
  imageUrl: string,
  options: FetchImageWithStallDetectionCoreOptions,
  controller: AbortController
): Promise<Response> {
  options.assertUrlAllowed?.(imageUrl)
  const requestInit: RequestInit = {
    // Session-dependent integrations opt in to credentials at the call site.
    credentials: "omit",
    ...options.init,
    // Fail before contacting a redirect target or sending credentials to it.
    redirect: allowsDeterministicE2eRedirect ? "follow" : "error",
    signal: controller.signal,
  }
  const fetcher = options.fetcher ?? fetchSharedResource
  return withAbortSignal(fetcher(imageUrl, requestInit), controller)
}

function validateImageResponse(
  response: Response,
  imageUrl: string,
  options: FetchImageWithStallDetectionCoreOptions
): string {
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
  return normalizeAllowedImageMimeType(response.headers.get("content-type"), {
    allowEncodedImageMimeType: options.allowEncodedImageMimeType,
  })
}

async function fetchImageBody(
  imageUrl: string,
  options: FetchImageWithStallDetectionCoreOptions,
  controller: AbortController
): Promise<FetchedImageData> {
  const response = await fetchImageResponse(imageUrl, options, controller)
  let readerOwnsBody = false
  try {
    const mimeType = validateImageResponse(response, imageUrl, options)
    await options.onResponse?.(response)
    const stallTimeoutMs = options.stallTimeoutMs ?? STALL_TIMEOUT_MS
    if (!response.body) {
      const data = await readImageArrayBuffer(
        response,
        options,
        controller,
        stallTimeoutMs
      )
      return { data, mimeType }
    }
    const reader = response.body.getReader()
    readerOwnsBody = true
    const data = await readImageStream(
      reader,
      options,
      controller,
      stallTimeoutMs
    )
    return { data, mimeType }
  } finally {
    if (!readerOwnsBody && response.body) {
      void response.body.cancel().catch(() => undefined)
    }
  }
}

function assertImageByteLimit(
  bytes: number,
  controller: AbortController
): void {
  if (bytes <= MAX_IMAGE_BYTES) return
  const error = new NonRetryableDownloadError(
    `Image size exceeds ${MAX_IMAGE_BYTES} byte limit (got ${bytes})`
  )
  controller.abort(error)
  throw error
}

async function readImageArrayBuffer(
  response: Response,
  options: FetchImageWithStallDetectionCoreOptions,
  controller: AbortController,
  stallTimeoutMs: number
): Promise<ArrayBuffer> {
  const data = await withStallTimeout(
    response.arrayBuffer(),
    stallTimeoutMs,
    `Image body stalled after ${stallTimeoutMs}ms`,
    controller
  )
  await options.onBytesReceived?.(data.byteLength)
  assertImageByteLimit(data.byteLength, controller)
  return data
}

async function readImageStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: FetchImageWithStallDetectionCoreOptions,
  controller: AbortController,
  stallTimeoutMs: number
): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const result = await withStallTimeout(
        reader.read(),
        stallTimeoutMs,
        `Image download stalled after ${stallTimeoutMs}ms`,
        controller
      )
      if (result.done) break
      if (!result.value || result.value.byteLength === 0) continue
      const nextTotalBytes = totalBytes + result.value.byteLength
      assertImageByteLimit(nextTotalBytes, controller)
      await reportImageBytes(nextTotalBytes, options, controller)
      chunks.push(result.value)
      totalBytes = nextTotalBytes
    }
  } catch (error) {
    void reader.cancel(error).catch(() => undefined)
    throw error
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // A reader may already have released its lock during cancellation.
    }
  }
  const merged = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged.buffer
}

async function reportImageBytes(
  bytes: number,
  options: FetchImageWithStallDetectionCoreOptions,
  controller: AbortController
): Promise<void> {
  try {
    await options.onBytesReceived?.(bytes)
  } catch (error) {
    controller.abort(error)
    throw error
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
  controller: AbortController
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
