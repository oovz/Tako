import { describe, expect, it } from "vitest"
import { getRateLimitPolicyFromSnapshot } from "@/src/runtime/rate-limit"
import { normalizeDownloadErrorCategory } from "@/src/shared/download-contract"

describe("persisted download policy", () => {
  it("selects the captured image and chapter policies independently", () => {
    const snapshot = {
      rateLimitSettings: {
        image: { concurrency: 4, delayMs: 50 },
        chapter: { concurrency: 1, delayMs: 300 },
      },
    }
    expect(getRateLimitPolicyFromSnapshot(snapshot, "image")).toEqual({
      concurrency: 4,
      delayMs: 50,
    })
    expect(getRateLimitPolicyFromSnapshot(snapshot, "chapter")).toEqual({
      concurrency: 1,
      delayMs: 300,
    })
    expect(getRateLimitPolicyFromSnapshot(undefined, "chapter")).toBeUndefined()
  })

  it.each([
    ["network", "network_unavailable"],
    ["download", "archive_creation_failed"],
    ["other", "unknown"],
  ] as const)("normalizes legacy error category %s", (legacy, canonical) => {
    expect(normalizeDownloadErrorCategory(legacy)).toBe(canonical)
  })
})
