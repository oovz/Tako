import { describe, expect, it } from "vitest"
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
})
