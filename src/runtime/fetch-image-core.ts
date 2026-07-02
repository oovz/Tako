import { HARD_TIMEOUT_MS, STALL_TIMEOUT_MS } from '@/src/constants/timeouts'
import { normalizeAllowedImageMimeType } from '@/src/shared/site-integration-utils'

export interface FetchImageWithStallDetectionCoreOptions {
  signal?: AbortSignal
  init?: RequestInit
  stallTimeoutMs?: number
  hardTimeoutMs?: number
  fetcher?: (imageUrl: string, init: RequestInit) => Promise<Response>
  createHttpError?: (response: Response) => Error
  onResponse?: (response: Response) => void | Promise<void>
  onBytesReceived?: (bytesReceived: number) => void | Promise<void>
}

/**
 * Fetches an image while enforcing body-progress stalls and a hard total request
 * timeout, with MIME validation.
 */
export async function fetchImageWithStallDetection(
  imageUrl: string,
  options: FetchImageWithStallDetectionCoreOptions = {},
): Promise<{ data: ArrayBuffer; mimeType: string }> {
  const stallTimeoutMs = options.stallTimeoutMs ?? STALL_TIMEOUT_MS
  const hardTimeoutMs = options.hardTimeoutMs ?? HARD_TIMEOUT_MS

  const controller = new AbortController()
  const onAbort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.signal?.aborted) {
    controller.abort(options.signal.reason)
  }

  const hardTimeoutId = setTimeout(() => {
    controller.abort(new Error(`Image download hard timeout after ${hardTimeoutMs}ms`))
  }, hardTimeoutMs)

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

  try {
    const requestInit: RequestInit = {
      credentials: 'include',
      ...options.init,
      signal: controller.signal,
    }
    const fetcher = options.fetcher ?? fetch
    const response = await withAbortSignal(fetcher(imageUrl, requestInit), controller)

    if (!response.ok) {
      throw options.createHttpError?.(response) ?? new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const mimeType = normalizeAllowedImageMimeType(response.headers.get('content-type'))
    await options.onResponse?.(response)

    if (!response.body) {
      const data = await withStallTimeout(
        response.arrayBuffer(),
        stallTimeoutMs,
        `Image body stalled after ${stallTimeoutMs}ms`,
        controller,
      )
      await options.onBytesReceived?.(data.byteLength)
      return { data, mimeType }
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
          },
        )

        if (stallTimeoutId) {
          clearTimeout(stallTimeoutId)
        }

        if (readResult.done) {
          break
        }

        if (readResult.value && readResult.value.byteLength > 0) {
          chunks.push(readResult.value)
          totalBytes += readResult.value.byteLength
          await options.onBytesReceived?.(totalBytes)
        }
      } catch (error) {
        if (stallTimeoutId) {
          clearTimeout(stallTimeoutId)
        }
        throw error
      }
    }

    const merged = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }

    return {
      data: merged.buffer,
      mimeType,
    }
  } finally {
    clearTimeout(hardTimeoutId)
    options.signal?.removeEventListener('abort', onAbort)
    try {
      reader?.releaseLock()
    } catch {
      // no-op
    }
  }
}

async function withAbortSignal<T>(
  promise: Promise<T>,
  controller: AbortController,
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
        controller.signal.addEventListener('abort', onAbort, { once: true })
      }),
    ])
  } finally {
    if (onAbort) {
      controller.signal.removeEventListener('abort', onAbort)
    }
  }
}

async function withStallTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  controller: AbortController,
  onTimeoutScheduled?: (timeoutId: ReturnType<typeof setTimeout>) => void,
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
        controller.signal.addEventListener('abort', onAbort, { once: true })

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
      controller.signal.removeEventListener('abort', onAbort)
    }
  }
}

function toAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('aborted')
}
