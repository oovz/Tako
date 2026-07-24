import { describe, expect, it } from "vitest"

import {
  normalizeImagePolicyOverride,
  normalizeRetryOverride,
} from "@/entrypoints/options/hooks/rate-policy-override"

describe("image rate policy override normalization", () => {
  it("preserves an explicit zero delay", () => {
    expect(normalizeImagePolicyOverride({ delayMs: 0 })).toEqual({
      delayMs: 0,
    })
  })

  it("removes a policy only when both fields are absent", () => {
    expect(normalizeImagePolicyOverride({})).toBeUndefined()
    expect(normalizeImagePolicyOverride({ concurrency: 2 })).toEqual({
      concurrency: 2,
    })
  })
})

describe("retry override normalization", () => {
  it("removes the nested retry object when both fields are absent", () => {
    expect(
      normalizeRetryOverride({ image: undefined, chapter: undefined })
    ).toBeUndefined()
  })

  it("preserves explicit zero retry counts", () => {
    expect(normalizeRetryOverride({ image: 0 })).toEqual({ image: 0 })
  })
})
