import { describe, expect, it, vi } from "vitest"
import {
  OffscreenLiveResourceLedger,
  OffscreenLiveResourceLimitError,
} from "@/src/runtime/offscreen-live-resource-ledger"

describe("live resource acquisition ordering", () => {
  it("rejects impossible and already canceled requests without retaining resources", async () => {
    const ledger = new OffscreenLiveResourceLedger(10)
    await expect(ledger.acquire("large", 11)).rejects.toBeInstanceOf(
      OffscreenLiveResourceLimitError
    )
    const controller = new AbortController()
    controller.abort("canceled before enqueue")
    await expect(
      ledger.acquire("canceled", 1, controller.signal)
    ).rejects.toThrow("canceled before enqueue")
    expect(ledger.getUsedBytes()).toBe(0)
  })

  it("rejects a cancelled waiter before capacity release and preserves the earlier waiter", async () => {
    const ledger = new OffscreenLiveResourceLedger(10)
    const held = ledger.reserve(10, "held")
    const leases = [held]
    const firstController = new AbortController()
    const secondController = new AbortController()
    const firstGranted = vi.fn()
    const firstRejected = vi.fn()
    const secondGranted = vi.fn()
    let cancellation: unknown
    const secondRejected = vi.fn((error: unknown) => {
      cancellation = error
    })
    const first = ledger
      .acquire("earlier", 6, firstController.signal)
      .then((lease) => {
        leases.push(lease)
        firstGranted()
      }, firstRejected)
    const second = ledger
      .acquire("cancelled", 4, secondController.signal)
      .then((lease) => {
        leases.push(lease)
        secondGranted()
      }, secondRejected)

    try {
      const reason = new Error("cancel only this acquisition")
      secondController.abort(reason)
      await Promise.resolve()

      expect(secondRejected).toHaveBeenCalledTimes(1)
      expect(cancellation).toBe(reason)
      expect(secondGranted).not.toHaveBeenCalled()
      expect(firstGranted).not.toHaveBeenCalled()
      expect(ledger.getUsedBytes()).toBe(10)

      held.release()
      await first

      expect(firstRejected).not.toHaveBeenCalled()
      expect(firstGranted).toHaveBeenCalledTimes(1)
      expect(ledger.getUsedBytes()).toBe(6)
    } finally {
      held.release()
      firstController.abort()
      secondController.abort()
      await Promise.all([first, second])
      for (const lease of leases) lease.release()
      expect(ledger.getUsedBytes()).toBe(0)
    }
  })
})
