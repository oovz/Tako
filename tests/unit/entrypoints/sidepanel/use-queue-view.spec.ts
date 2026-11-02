// @vitest-environment happy-dom

import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"

import {
  normalizeHistoryView,
  normalizeQueueProjection,
  normalizeQueueView,
  useQueueView,
} from "@/entrypoints/sidepanel/hooks/useQueueView"

function makeQueueTask(
  id: string,
  status: string,
  seriesTitle: string,
  created = 1000
) {
  return {
    destination: { kind: "downloads-api" },
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
  it("accepts an absent projection and rejects malformed collections", () => {
    expect(normalizeQueueView(undefined)).toEqual([])
    expect(() => normalizeQueueView({})).toThrow()
    expect(() => normalizeQueueView(null)).toThrow()
  })

  it("preserves optional output evidence and rejects malformed destinations", () => {
    expect(
      normalizeQueueView([
        {
          ...makeQueueTask("native", "completed", "Series A"),
          outputDestination: "downloads-api",
          outputMode: "fsa",
          saveConfirmedAt: 42,
          outputUncertain: true,
        },
      ])[0]
    ).toMatchObject({
      outputDestination: "downloads-api",
      outputMode: "fsa",
      saveConfirmedAt: 42,
      outputUncertain: true,
    })
    expect(
      normalizeQueueView([makeQueueTask("old", "completed", "Series A")])[0]
        .outputDestination
    ).toBeUndefined()
    expect(() =>
      normalizeQueueView([
        {
          ...makeQueueTask("invalid", "completed", "Series A"),
          outputDestination: "unknown",
        },
      ])
    ).toThrow()
  })

  it("rejects a projection containing malformed task summaries", () => {
    expect(() =>
      normalizeQueueView([
        makeQueueTask("task-1", "queued", "Series A"),
        {
          id: "task-2",
          status: "downloading",
        },
        "invalid-item",
      ])
    ).toThrow()
  })

  it("rejects queue items with unsupported status values", () => {
    expect(() =>
      normalizeQueueView([
        makeQueueTask("task-1", "waiting", "Series A"),
        makeQueueTask("task-2", "failed", "Series B"),
      ])
    ).toThrow()
  })

  it("strips malformed optional summary fields while preserving valid ones", () => {
    const normalized = normalizeQueueView([
      {
        ...makeQueueTask("task-1", "completed", "Series A"),
        coverUrl: 123,
        failureReason: ["legacy raw error"],
        failureCategory: "bogus",
        isRetried: "yes",
        isRetryTask: true,
        lastSuccessfulDownloadId: "nope",
      },
      {
        ...makeQueueTask("task-2", "partial_success", "Series B"),
        coverUrl: "https://example.com/cover.jpg",
        failureReason: "https://signed.example/image?token=secret",
        failureCategory: "network_unavailable",
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
        isRetried: undefined,
        isRetryTask: true,
        lastSuccessfulDownloadId: undefined,
      },
      {
        ...makeQueueTask("task-2", "partial_success", "Series B"),
        coverUrl: "https://example.com/cover.jpg",
        failureCategory: "network_unavailable",
        isRetried: false,
        isRetryTask: true,
        lastSuccessfulDownloadId: 42,
      },
    ])
  })

  it("drops unsafe cover URLs from an older stored projection", () => {
    const normalized = normalizeQueueView([
      {
        ...makeQueueTask("task-1", "completed", "Series A"),
        coverUrl: "https://127.0.0.1/cover.jpg",
      },
    ])

    expect(normalized).toEqual([
      {
        ...makeQueueTask("task-1", "completed", "Series A"),
        coverUrl: undefined,
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
    expect(() =>
      normalizeQueueProjection([
        makeQueueTask("task-1", "completed", "Series A"),
        makeQueueTask("task-2", "queued", "Series B"),
      ])
    ).toThrow()
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

it("publishes active and queued task collections after the shared projection hydrates", async () => {
  const pending = Promise.withResolvers<Record<string, unknown>>()
  const listeners = new Set<
    Parameters<typeof chrome.storage.onChanged.addListener>[0]
  >()
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("chrome", {
    storage: {
      session: { get: () => pending.promise },
      onChanged: {
        addListener: (
          listener: Parameters<typeof chrome.storage.onChanged.addListener>[0]
        ) => listeners.add(listener),
        removeListener: (
          listener: Parameters<typeof chrome.storage.onChanged.addListener>[0]
        ) => listeners.delete(listener),
      },
    },
  })
  const container = document.createElement("div")
  const root = createRoot(container)
  let state!: ReturnType<typeof useQueueView>
  function View() {
    state = useQueueView()
    return createElement("output", null, state.status)
  }
  try {
    await act(async () => root.render(createElement(View)))
    expect(state.isLoading).toBe(true)
    expect(state.queueView).toEqual([])
    await act(async () =>
      pending.resolve({
        queueView: [
          {
            ...makeQueueTask("active", "downloading", "Active"),
            chapters: { total: 3, completed: 0, unsuccessful: 0 },
          },
          {
            ...makeQueueTask("next", "queued", "Next"),
            chapters: { total: 3, completed: 0, unsuccessful: 0 },
          },
          {
            ...makeQueueTask("later", "queued", "Later"),
            chapters: { total: 3, completed: 0, unsuccessful: 0 },
          },
        ],
        historyView: [
          {
            ...makeQueueTask("finished", "completed", "Finished"),
            chapters: { total: 3, completed: 3, unsuccessful: 0 },
            timestamps: { created: 1, completed: 2 },
          },
        ],
      })
    )
    expect(state.isLoading).toBe(false)
    expect(state.status).toBe("ready")
    expect(state.activeTasks.map((task) => task.id)).toEqual(["active"])
    expect(state.queuedTasks.map((task) => task.id)).toEqual(["next", "later"])
    expect(state.activeCount).toBe(1)
    expect(state.queuedCount).toBe(2)
    expect(state.historyTasks.map((task) => task.id)).toEqual(["finished"])
  } finally {
    act(() => root.unmount())
    vi.unstubAllGlobals()
  }
  expect(listeners.size).toBe(0)
})
