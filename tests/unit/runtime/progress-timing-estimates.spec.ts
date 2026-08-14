import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  ProgressTimingEstimator,
  progressTimingEstimateKey,
} from "@/src/runtime/progress-timing-estimates"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"

const context = {
  integrationId: "pixiv-comic",
  archiveFormat: "cbz",
  destination: "downloads-api",
} as const

describe("ProgressTimingEstimator", () => {
  const localGet = vi.fn(async () => ({}) as Record<string, unknown>)
  const localSet = vi.fn(async (_items: Record<string, unknown>) => undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    localGet.mockResolvedValue({})
    localSet.mockResolvedValue(undefined)
    vi.stubGlobal("chrome", {
      storage: {
        local: { get: localGet, set: localSet },
      },
    })
  })

  it("uses integration-aware defaults when no local samples exist", async () => {
    const estimator = new ProgressTimingEstimator()

    await expect(estimator.getCosts(context)).resolves.toEqual({
      resolving: 800,
      downloading: 12_000,
      transforming: 0,
      archiving: 2_500,
      saving: 1_000,
    })
  })

  it("records phase transitions and updates the local EWMA", async () => {
    const estimator = new ProgressTimingEstimator()
    const key = progressTimingEstimateKey(context, "downloading")

    await estimator.observe({
      jobId: "job-1",
      stage: "downloading",
      context,
      now: 0,
    })
    await estimator.observe({
      jobId: "job-1",
      stage: "archiving",
      context,
      now: 1_000,
    })
    await estimator.observe({
      jobId: "job-2",
      stage: "downloading",
      context,
      now: 2_000,
    })
    await estimator.observe({
      jobId: "job-2",
      stage: "archiving",
      context,
      now: 4_000,
    })

    const persisted = localSet.mock.calls.at(-1)?.[0] as Record<
      string,
      Record<string, number>
    >
    expect(persisted[LOCAL_STORAGE_KEYS.progressTimingEstimates]?.[key]).toBe(
      1_250
    )
  })

  it("ignores invalid persisted samples", async () => {
    localGet.mockResolvedValue({
      [LOCAL_STORAGE_KEYS.progressTimingEstimates]: {
        [progressTimingEstimateKey(context, "downloading")]: -1,
        [progressTimingEstimateKey(context, "saving")]: Number.NaN,
      },
    })
    const estimator = new ProgressTimingEstimator()

    await expect(estimator.getCosts(context)).resolves.toMatchObject({
      downloading: 12_000,
      saving: 1_000,
    })
  })

  it("treats timing-storage failures as non-fatal", async () => {
    localGet.mockRejectedValueOnce(new Error("read unavailable"))
    localSet.mockRejectedValueOnce(new Error("write unavailable"))
    const estimator = new ProgressTimingEstimator()

    await expect(estimator.getCosts(context)).resolves.toMatchObject({
      downloading: 12_000,
    })
    await estimator.observe({
      jobId: "job-1",
      stage: "downloading",
      context,
      now: 0,
    })
    await expect(
      estimator.observe({
        jobId: "job-1",
        stage: "archiving",
        context,
        now: 1_000,
      })
    ).resolves.toEqual({
      resolving: 800,
      downloading: 1_000,
      transforming: 0,
      archiving: 2_500,
      saving: 1_000,
    })
  })
})
