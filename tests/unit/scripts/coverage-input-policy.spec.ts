import { describe, expect, it } from "vitest"

import { assertCompleteCoverageInputs } from "@/scripts/coverage-input-policy.mjs"

describe("coverage merge input policy", () => {
  it("requires both Vitest and E2E coverage inputs", () => {
    expect(() =>
      assertCompleteCoverageInputs({
        hasVitestCoverage: false,
        e2ePageCoverageFileCount: 1,
        e2eWorkerCoverageFileCount: 1,
      })
    ).toThrow(/Vitest coverage is missing/)

    expect(() =>
      assertCompleteCoverageInputs({
        hasVitestCoverage: true,
        e2ePageCoverageFileCount: 0,
        e2eWorkerCoverageFileCount: 1,
      })
    ).toThrow(/E2E page coverage is missing/)

    expect(() =>
      assertCompleteCoverageInputs({
        hasVitestCoverage: true,
        e2ePageCoverageFileCount: 1,
        e2eWorkerCoverageFileCount: 0,
      })
    ).toThrow(/service-worker coverage is missing/)
  })

  it("accepts a complete pair of coverage sources", () => {
    expect(() =>
      assertCompleteCoverageInputs({
        hasVitestCoverage: true,
        e2ePageCoverageFileCount: 1,
        e2eWorkerCoverageFileCount: 1,
      })
    ).not.toThrow()
  })
})
