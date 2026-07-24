import { describe, expect, it } from "vitest"

import {
  calculatePhaseWeightedChapterFraction,
  calculateTimeWeightedTaskFraction,
  getInitialProgressPhaseCosts,
} from "@/src/runtime/progress-calculator"

describe("time-weighted progress", () => {
  it("gives integrated transforms more influence over image progress", () => {
    const base = getInitialProgressPhaseCosts({
      integrationId: "mangadex",
      archiveFormat: "cbz",
      destination: "downloads-api",
    })
    const transformed = getInitialProgressPhaseCosts({
      integrationId: "pixiv-comic",
      archiveFormat: "cbz",
      destination: "downloads-api",
    })
    const baseDelta =
      calculatePhaseWeightedChapterFraction({
        costs: base,
        stage: "downloading",
        phaseFraction: 0.75,
      }) -
      calculatePhaseWeightedChapterFraction({
        costs: base,
        stage: "downloading",
        phaseFraction: 0.25,
      })
    const transformedDelta =
      calculatePhaseWeightedChapterFraction({
        costs: transformed,
        stage: "downloading",
        phaseFraction: 0.75,
      }) -
      calculatePhaseWeightedChapterFraction({
        costs: transformed,
        stage: "downloading",
        phaseFraction: 0.25,
      })

    expect(transformedDelta).toBeGreaterThan(baseDelta)
  })

  it("removes archive cost for unarchived image output", () => {
    expect(
      getInitialProgressPhaseCosts({
        integrationId: "mangadex",
        archiveFormat: "none",
        destination: "downloads-api",
      }).archiving
    ).toBe(0)
  })

  it("is monotonic and cannot reach 100% before destination commit", () => {
    expect(
      calculateTimeWeightedTaskFraction({
        totalChapters: 1,
        settledChapters: 0,
        activeChapterFractions: [1],
        previousDisplayedFraction: 0.8,
        destinationCommitted: false,
      })
    ).toBe(0.99)
    expect(
      calculateTimeWeightedTaskFraction({
        totalChapters: 2,
        settledChapters: 0,
        activeChapterFractions: [0.2],
        previousDisplayedFraction: 0.6,
        destinationCommitted: false,
      })
    ).toBe(0.6)
    expect(
      calculateTimeWeightedTaskFraction({
        totalChapters: 1,
        settledChapters: 1,
        activeChapterFractions: [],
        destinationCommitted: true,
      })
    ).toBe(1)
  })
})
