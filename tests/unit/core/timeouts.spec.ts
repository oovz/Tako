import { describe, expect, it } from "vitest"

import {
  STALL_TIMEOUT_MS,
  HARD_TIMEOUT_MS,
  IPC_THROTTLE_MS,
  TRANSITION_DURATION_MS,
  MAX_IMAGE_BYTES,
  ZIP_WORKER_FINALIZATION_TIMEOUT_MS,
} from "@/src/constants/timeouts"

describe("timeouts constants", () => {
  it("matches command center contract values", () => {
    expect(STALL_TIMEOUT_MS).toBe(30_000)
    expect(HARD_TIMEOUT_MS).toBe(150_000)
    expect(IPC_THROTTLE_MS).toBe(250)
    expect(TRANSITION_DURATION_MS).toBe(275)
  })

  it("keeps timeout ordering sane", () => {
    expect(HARD_TIMEOUT_MS).toBeGreaterThan(STALL_TIMEOUT_MS)
  })
})

describe("MAX_IMAGE_BYTES decompression bomb guard", () => {
  it("is exactly 100MB (100 * 1024 * 1024)", () => {
    expect(MAX_IMAGE_BYTES).toBe(100 * 1024 * 1024)
  })

  it("is large enough to allow typical cover/page images but block decompression bombs", () => {
    expect(MAX_IMAGE_BYTES).toBeGreaterThan(10 * 1024 * 1024) // > 10MB
    expect(MAX_IMAGE_BYTES).toBeLessThan(1024 * 1024 * 1024) // < 1GB
  })
})

describe("ZIP_WORKER_FINALIZATION_TIMEOUT_MS guard", () => {
  it("is exactly 5 minutes (5 * 60 * 1000)", () => {
    expect(ZIP_WORKER_FINALIZATION_TIMEOUT_MS).toBe(5 * 60 * 1000)
  })

  it("is longer than the hard download timeout to allow finalization after downloads complete", () => {
    expect(ZIP_WORKER_FINALIZATION_TIMEOUT_MS).toBeGreaterThan(HARD_TIMEOUT_MS)
  })

  it("is imported and referenced by chapter-processing.ts (contract)", async () => {
    // Read the source module as text to verify the constant is wired into the
    // finalization timeout without importing the worker (which has side effects).
    const source =
      await import("@/entrypoints/offscreen/chapter-processing.ts?raw")
    expect(String(source.default)).toContain(
      "ZIP_WORKER_FINALIZATION_TIMEOUT_MS"
    )
  })
})

describe("IPC_THROTTLE_MS guard", () => {
  it("is exactly 250ms", () => {
    expect(IPC_THROTTLE_MS).toBe(250)
  })
})
