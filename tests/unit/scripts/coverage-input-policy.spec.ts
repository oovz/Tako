import { describe, expect, it } from "vitest"

import { assertCompleteCoverageInputs } from "@/scripts/coverage-input-policy.mjs"

describe("coverage merge input policy", () => {
  it("requires native V8, runtime Istanbul, page and worker coverage inputs", () => {
    expect(() =>
      assertCompleteCoverageInputs({
        hasVitestCoverage: false,
        hasRuntimeCoverage: true,
        e2ePageCoverageFileCount: 1,
        e2eWorkerCoverageFileCount: 1,
      })
    ).toThrow(/Vitest coverage is missing/)

    expect(() =>
      assertCompleteCoverageInputs({
        hasVitestCoverage: true,
        hasRuntimeCoverage: true,
        e2ePageCoverageFileCount: 0,
        e2eWorkerCoverageFileCount: 1,
      })
    ).toThrow(/E2E page coverage is missing/)

    expect(() =>
      assertCompleteCoverageInputs({
        hasVitestCoverage: true,
        hasRuntimeCoverage: true,
        e2ePageCoverageFileCount: 1,
        e2eWorkerCoverageFileCount: 0,
      })
    ).toThrow(/service-worker coverage is missing/)

    expect(() =>
      assertCompleteCoverageInputs({
        hasVitestCoverage: true,
        hasRuntimeCoverage: false,
        e2ePageCoverageFileCount: 1,
        e2eWorkerCoverageFileCount: 1,
      })
    ).toThrow(/Runtime Istanbul coverage is missing/)
  })

  it("accepts both native profiles and browser coverage contexts", () => {
    expect(() =>
      assertCompleteCoverageInputs({
        hasVitestCoverage: true,
        hasRuntimeCoverage: true,
        e2ePageCoverageFileCount: 1,
        e2eWorkerCoverageFileCount: 1,
      })
    ).not.toThrow()
  })
})
