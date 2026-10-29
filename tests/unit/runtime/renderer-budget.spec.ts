import assert from "node:assert/strict"
import { setImmediate } from "node:timers/promises"
import { describe, expect, it, vi } from "vitest"
import {
  MAX_RENDERER_IMAGE_PIXELS,
  withRendererPixelBudget,
} from "@/src/runtime/renderer-budget"

describe("renderer pixel budget", () => {
  it("does not overlap work beyond the shared pixel envelope", async () => {
    let releaseFirst: (() => void) | undefined
    let secondStarted = false

    const first = withRendererPixelBudget(
      MAX_RENDERER_IMAGE_PIXELS,
      undefined,
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
    )
    await Promise.resolve()

    const second = withRendererPixelBudget(1, undefined, () => {
      secondStarted = true
    })
    await Promise.resolve()
    expect(secondStarted).toBe(false)

    releaseFirst?.()
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()
    expect(secondStarted).toBe(true)
  })

  it("cancels a transform while it is waiting for renderer capacity", async () => {
    let releaseFirst: (() => void) | undefined
    const first = withRendererPixelBudget(
      MAX_RENDERER_IMAGE_PIXELS,
      undefined,
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
    )
    await Promise.resolve()

    const controller = new AbortController()
    const second = withRendererPixelBudget(1, controller.signal, () => {
      throw new Error("should not start")
    })
    const reason = new Error("job-cancelled")
    controller.abort(reason)

    await expect(second).rejects.toBe(reason)
    releaseFirst?.()
    await expect(first).resolves.toBeUndefined()
  })

  it("admits fitting work when a larger queued request is cancelled", async () => {
    let releaseFirst: (() => void) | undefined
    const first = withRendererPixelBudget(
      MAX_RENDERER_IMAGE_PIXELS / 2,
      undefined,
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
    )
    await setImmediate()

    const controller = new AbortController()
    const blocked = withRendererPixelBudget(
      MAX_RENDERER_IMAGE_PIXELS,
      controller.signal,
      () => assert.fail("Cancelled work must not start")
    )
    const reason = new Error("job-cancelled")
    const cancelled = assert.rejects(blocked, (error) => error === reason)
    let fittingWorkStarted = false
    const fitting = withRendererPixelBudget(
      MAX_RENDERER_IMAGE_PIXELS / 2,
      undefined,
      () => {
        fittingWorkStarted = true
      }
    )

    try {
      await setImmediate()
      assert.equal(fittingWorkStarted, false)
      controller.abort(reason)
      await cancelled
      await setImmediate()
      assert.equal(fittingWorkStarted, true)
    } finally {
      controller.abort(reason)
      releaseFirst?.()
      await Promise.all([first, fitting, cancelled])
    }
  })

  it("rejects an image whose two decoded surfaces exceed the envelope", async () => {
    await expect(
      withRendererPixelBudget(
        MAX_RENDERER_IMAGE_PIXELS + 1,
        undefined,
        () => undefined
      )
    ).rejects.toThrow("Renderer image pixels must be between")
  })

  it.each([0, -1, 1.5, NaN, Infinity])(
    "rejects invalid pixel count %s before starting work",
    async (pixels) => {
      const operation = vi.fn()
      await expect(
        withRendererPixelBudget(pixels, undefined, operation)
      ).rejects.toBeInstanceOf(RangeError)
      expect(operation).not.toHaveBeenCalled()
    }
  )

  it.each([new Error("cancelled before admission"), "cancelled"])(
    "rejects an already cancelled request with reason %s",
    async (reason) => {
      const controller = new AbortController()
      controller.abort(reason)
      const operation = vi.fn()
      const result = withRendererPixelBudget(1, controller.signal, operation)
      if (reason instanceof Error) {
        await expect(result).rejects.toBe(reason)
      } else {
        await expect(result).rejects.toThrow("aborted")
      }
      expect(operation).not.toHaveBeenCalled()
    }
  )

  it("releases capacity after a transform rejects", async () => {
    let failFirst: ((reason: Error) => void) | undefined
    const failure = new Error("Transform failed")
    const first = withRendererPixelBudget(
      MAX_RENDERER_IMAGE_PIXELS,
      undefined,
      () =>
        new Promise<void>((_resolve, reject) => {
          failFirst = reject
        })
    )
    const firstRejected = expect(first).rejects.toBe(failure)
    const nextOperation = vi.fn()
    const second = withRendererPixelBudget(
      MAX_RENDERER_IMAGE_PIXELS,
      undefined,
      nextOperation
    )
    await setImmediate()
    expect(nextOperation).not.toHaveBeenCalled()
    failFirst?.(failure)
    await firstRejected
    await second
    expect(nextOperation).toHaveBeenCalledOnce()
  })
})
