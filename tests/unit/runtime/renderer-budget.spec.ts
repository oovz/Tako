import { describe, expect, it } from "vitest"
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

  it("rejects an image whose two decoded surfaces exceed the envelope", async () => {
    await expect(
      withRendererPixelBudget(
        MAX_RENDERER_IMAGE_PIXELS + 1,
        undefined,
        () => undefined
      )
    ).rejects.toThrow("Renderer image pixels must be between")
  })
})
