import { describe, expect, it } from "vitest"

import {
  normalizeHistoryView,
  normalizeQueueProjection,
  normalizeQueueView,
} from "@/entrypoints/sidepanel/hooks/useQueueView"

function makeQueueTask(
  id: string,
  status: string,
  seriesTitle: string,
  created = 1000
) {
  return {
    id,
    seriesKey: `mangadex#${id}`,
    seriesTitle,
    siteIntegration: "mangadex",
    status,
    chapters: {
      total: 3,
      completed: 1,
      unsuccessful: 0,
    },
    timestamps: {
      created,
    },
  }
}

describe("useQueueView normalizeQueueView", () => {
  it("returns empty array for non-array input", () => {
    expect(normalizeQueueView(undefined)).toEqual([])
    expect(normalizeQueueView({})).toEqual([])
  })

  it("keeps only valid queue task summaries", () => {
    const normalized = normalizeQueueView([
      makeQueueTask("task-1", "queued", "Series A"),
      {
        id: "task-2",
        status: "downloading",
      },
      "invalid-item",
    ])

    expect(normalized).toEqual([makeQueueTask("task-1", "queued", "Series A")])
  })

  it("rejects queue items with unsupported status values", () => {
    const normalized = normalizeQueueView([
      makeQueueTask("task-1", "waiting", "Series A"),
      makeQueueTask("task-2", "failed", "Series B"),
    ])

    expect(normalized).toEqual([makeQueueTask("task-2", "failed", "Series B")])
  })

  it("strips malformed optional summary fields while preserving valid ones", () => {
    const normalized = normalizeQueueView([
      {
        ...makeQueueTask("task-1", "completed", "Series A"),
        coverUrl: 123,
        failureReason: ["legacy raw error"],
        failureCategory: "bogus",
        hasUnobservableOutput: "yes",
        isRetried: "yes",
        isRetryTask: true,
        lastSuccessfulDownloadId: "nope",
      },
      {
        ...makeQueueTask("task-2", "partial_success", "Series B"),
        coverUrl: "https://example.com/cover.jpg",
        failureReason: "https://signed.example/image?token=secret",
        failureCategory: "network_unavailable",
        hasUnobservableOutput: true,
        isRetried: false,
        isRetryTask: true,
        lastSuccessfulDownloadId: 42,
      },
    ])

    expect(normalized).toEqual([
      {
        ...makeQueueTask("task-1", "completed", "Series A"),
        coverUrl: undefined,
        failureCategory: undefined,
        hasUnobservableOutput: undefined,
        isRetried: undefined,
        isRetryTask: true,
        lastSuccessfulDownloadId: undefined,
      },
      {
        ...makeQueueTask("task-2", "partial_success", "Series B"),
        coverUrl: "https://example.com/cover.jpg",
        failureCategory: "network_unavailable",
        hasUnobservableOutput: true,
        isRetried: false,
        isRetryTask: true,
        lastSuccessfulDownloadId: 42,
      },
    ])
  })

  it("normalizes history independently from the nonterminal queue projection", () => {
    expect(
      normalizeHistoryView([
        makeQueueTask("task-1", "completed", "Series A"),
        makeQueueTask("task-2", "queued", "Series B"),
      ]).map((task) => task.id)
    ).toEqual(["task-1"])
  })

  it("rejects a raw array instead of guessing its projection contract", () => {
    const projection = normalizeQueueProjection([
      makeQueueTask("task-1", "completed", "Series A"),
      makeQueueTask("task-2", "queued", "Series B"),
    ])

    expect(projection).toEqual({ queueView: [], historyView: [] })
  })

  it("does not synthesize history when the history projection is absent", () => {
    const projection = normalizeQueueProjection({
      queueView: [
        makeQueueTask("task-1", "failed", "Series A"),
        makeQueueTask("task-2", "queued", "Series B"),
      ],
    })

    expect(projection.queueView.map((task) => task.id)).toEqual(["task-2"])
    expect(projection.historyView).toEqual([])
  })
})
