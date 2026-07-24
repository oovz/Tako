import { describe, expect, it } from "vitest"

import {
  clampRatePolicyInteger,
  parseOptionalRatePolicyInteger,
  RATE_POLICY_LIMITS,
} from "@/src/shared/rate-policy-limits"

describe("rate-policy limits", () => {
  it("clamps and integer-normalizes numeric input", () => {
    expect(
      clampRatePolicyInteger(
        -1,
        RATE_POLICY_LIMITS.MIN_CONCURRENCY,
        RATE_POLICY_LIMITS.MAX_CONCURRENCY
      )
    ).toBe(1)
    expect(
      clampRatePolicyInteger(
        99,
        RATE_POLICY_LIMITS.MIN_CONCURRENCY,
        RATE_POLICY_LIMITS.MAX_CONCURRENCY
      )
    ).toBe(10)
    expect(
      clampRatePolicyInteger(
        3.8,
        RATE_POLICY_LIMITS.MIN_CONCURRENCY,
        RATE_POLICY_LIMITS.MAX_CONCURRENCY
      )
    ).toBe(3)
  })

  it("maps blank optional input to inheritance and clamps explicit values", () => {
    expect(parseOptionalRatePolicyInteger(" ", 0, 5000)).toBeUndefined()
    expect(parseOptionalRatePolicyInteger("9000", 0, 5000)).toBe(5000)
    expect(parseOptionalRatePolicyInteger("-20", 0, 5000)).toBe(0)
    expect(
      parseOptionalRatePolicyInteger("not-a-number", 0, 5000)
    ).toBeUndefined()
  })
})
