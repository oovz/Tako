import { MAX_DECODED_IMAGE_PIXELS } from "@/src/constants/timeouts"

// Every current renderer transform retains one decoded input bitmap and one
// equally sized output canvas. Preserve the per-image limit while accounting
// for both live pixel surfaces in the shared envelope.
export const MAX_RENDERER_IMAGE_PIXELS = MAX_DECODED_IMAGE_PIXELS
export const MAX_RENDERER_SURFACE_PIXELS = MAX_RENDERER_IMAGE_PIXELS * 2

type RendererBudgetWaiter = {
  pixels: number
  signal?: AbortSignal
  operation: () => unknown
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  canceled: boolean
  cleanup: () => void
}

let reservedPixels = 0
const waiters: RendererBudgetWaiter[] = []

function removeWaiter(waiter: RendererBudgetWaiter): void {
  const index = waiters.indexOf(waiter)
  if (index >= 0) waiters.splice(index, 1)
}

function drainRendererBudget(): void {
  while (waiters.length > 0) {
    const waiter = waiters[0]
    if (!waiter) return
    if (waiter.canceled) {
      waiters.shift()
      continue
    }
    if (reservedPixels + waiter.pixels > MAX_RENDERER_SURFACE_PIXELS) return

    waiters.shift()
    waiter.cleanup()
    reservedPixels += waiter.pixels
    void Promise.resolve()
      .then(waiter.operation)
      .then(waiter.resolve, waiter.reject)
      .finally(() => {
        reservedPixels -= waiter.pixels
        drainRendererBudget()
      })
  }
}

export function withRendererPixelBudget<T>(
  imagePixels: number,
  signal: AbortSignal | undefined,
  operation: () => Promise<T> | T
): Promise<T> {
  if (
    !Number.isSafeInteger(imagePixels) ||
    imagePixels <= 0 ||
    imagePixels > MAX_RENDERER_IMAGE_PIXELS
  ) {
    return Promise.reject(
      new RangeError(
        `Renderer image pixels must be between 1 and ${MAX_RENDERER_IMAGE_PIXELS}`
      )
    )
  }

  if (signal?.aborted) {
    return Promise.reject(
      signal.reason instanceof Error ? signal.reason : new Error("aborted")
    )
  }

  return new Promise<T>((resolve, reject) => {
    const surfacePixels = imagePixels * 2
    const waiter: RendererBudgetWaiter = {
      pixels: surfacePixels,
      signal,
      operation,
      resolve: (value) => resolve(value as T),
      reject,
      canceled: false,
      cleanup: () => undefined,
    }
    const onAbort = () => {
      waiter.canceled = true
      removeWaiter(waiter)
      waiter.cleanup()
      reject(
        signal?.reason instanceof Error ? signal.reason : new Error("aborted")
      )
    }
    waiter.cleanup = () => signal?.removeEventListener("abort", onAbort)
    signal?.addEventListener("abort", onAbort, { once: true })
    waiters.push(waiter)
    drainRendererBudget()
  })
}
