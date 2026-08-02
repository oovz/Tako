import { describe, expect, it, vi } from "vitest"

import { createInitializationBarrier } from "@/src/runtime/initialization-barrier"

describe("createInitializationBarrier", () => {
  it("initializes at most once after success", async () => {
    let initialized = false
    const initialize = vi.fn(async () => {
      initialized = true
    })

    const barrier = createInitializationBarrier({
      isInitialized: () => initialized,
      initialize,
    })

    await barrier.ensureInitialized()
    await barrier.ensureInitialized()

    expect(initialize).toHaveBeenCalledTimes(1)
  })

  it("coalesces concurrent callers and retries after a failed attempt", async () => {
    const transientError = new Error("storage temporarily unavailable")
    let initialized = false
    const initialize = vi.fn(async () => {
      if (initialize.mock.calls.length === 1) {
        throw transientError
      }

      initialized = true
    })

    const barrier = createInitializationBarrier({
      isInitialized: () => initialized,
      initialize,
    })

    const firstAttempt = Promise.allSettled([
      barrier.ensureInitialized(),
      barrier.ensureInitialized(),
    ])
    await expect(firstAttempt).resolves.toEqual([
      { status: "rejected", reason: transientError },
      { status: "rejected", reason: transientError },
    ])

    await expect(barrier.ensureInitialized()).resolves.toBeUndefined()
    expect(initialize).toHaveBeenCalledTimes(2)
  })
})
