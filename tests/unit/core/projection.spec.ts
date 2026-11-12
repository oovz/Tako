import { afterEach, describe, expect, it, vi } from "vitest"

import {
  getBadgeText,
  projectToQueueView,
  updateActionBadge,
} from "@/src/runtime/projection"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import type { DownloadTaskState } from "@/src/domain/queue/state"

function makeTask(overrides: Partial<DownloadTaskState>): DownloadTaskState {
  const siteIntegrationId = overrides.siteIntegrationId ?? "mangadex"
  return {
    id: "task-id",
    siteIntegrationId,
    mangaId: "series-1",
    seriesTitle: "Series 1",
    chapters: [],
    status: "queued",
    created: 0,
    settingsSnapshot: createTaskSettingsSnapshot(
      DEFAULT_SETTINGS,
      siteIntegrationId
    ),
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("projectToQueueView", () => {
  it("groups tasks by queue and history status", () => {
    const tasks: DownloadTaskState[] = [
      makeTask({ id: "queued", status: "queued", created: 1 }),
      makeTask({ id: "downloading", status: "downloading", created: 2 }),
      makeTask({
        id: "completed",
        status: "completed",
        created: 3,
        completed: 13,
      }),
      makeTask({
        id: "partial",
        status: "partial_success",
        created: 4,
        completed: 14,
      }),
      makeTask({ id: "failed", status: "failed", created: 5, completed: 15 }),
      makeTask({
        id: "canceled",
        status: "canceled",
        created: 6,
        completed: 16,
      }),
    ]

    const result = projectToQueueView(tasks)

    expect(result.activeCount).toBe(1)
    expect(result.queuedCount).toBe(1)
    expect(result.nonTerminalCount).toBe(2)
    expect(result.historyView.map((task) => task.id)).toEqual([
      "canceled",
      "failed",
      "partial",
      "completed",
    ])
    expect(result.queueView.map((task) => task.id)).toEqual([
      "downloading",
      "queued",
    ])
  })

  it.each(["waiting", "pending"])(
    "rejects unknown task status %s",
    (status) => {
      const task = {
        ...makeTask({ status: "queued" }),
        status,
      } as unknown as DownloadTaskState

      expect(() => projectToQueueView([task])).toThrow(
        `Unhandled queue status: ${status}`
      )
    }
  )

  it("orders active first, queued next, and terminal by most recent completion", () => {
    const tasks: DownloadTaskState[] = [
      makeTask({
        id: "completed-old",
        status: "completed",
        created: 1,
        completed: 10,
      }),
      makeTask({ id: "queued-1", status: "queued", created: 2 }),
      makeTask({ id: "active", status: "downloading", created: 3 }),
      makeTask({
        id: "completed-new",
        status: "completed",
        created: 4,
        completed: 20,
      }),
      makeTask({ id: "queued-2", status: "queued", created: 5 }),
    ]

    const result = projectToQueueView(tasks)

    expect(result.queueView.map((task) => task.id)).toEqual([
      "active",
      "queued-1",
      "queued-2",
    ])
    expect(result.historyView.map((task) => task.id)).toEqual([
      "completed-new",
      "completed-old",
    ])

    expect(result.activeCount).toBe(1)
    expect(result.queuedCount).toBe(2)
    expect(result.nonTerminalCount).toBe(3)
  })

  it("keeps the former queue slot and start evidence after a task fails", () => {
    const tasks = [
      makeTask({ id: "first" }),
      makeTask({ id: "previously-queued", status: "failed", completed: 5 }),
      makeTask({
        id: "previously-active",
        status: "failed",
        started: 2,
        completed: 6,
      }),
      makeTask({ id: "last" }),
    ]
    const { queueView, historyView } = projectToQueueView(tasks)

    expect(queueView.map((task) => task.queueIndex)).toEqual([0, 3])
    expect(historyView).toMatchObject([
      { id: "previously-active", queueIndex: 2, timestamps: { started: 2 } },
      {
        id: "previously-queued",
        queueIndex: 1,
        timestamps: { started: undefined },
      },
    ])
  })

  it("counts and orders multiple active downloads before queued tasks", () => {
    const tasks: DownloadTaskState[] = [
      makeTask({ id: "queued-1", status: "queued", created: 4 }),
      makeTask({ id: "active-2", status: "downloading", created: 2 }),
      makeTask({ id: "active-1", status: "downloading", created: 1 }),
      makeTask({ id: "queued-2", status: "queued", created: 5 }),
    ]

    const result = projectToQueueView(tasks)

    expect(result.activeCount).toBe(2)
    expect(result.queuedCount).toBe(2)
    expect(result.nonTerminalCount).toBe(4)
    expect(result.queueView.map((task) => task.id)).toEqual([
      "active-1",
      "active-2",
      "queued-1",
      "queued-2",
    ])
  })

  it("preserves series cover URLs for queue task media rendering", () => {
    const tasks: DownloadTaskState[] = [
      makeTask({
        id: "with-cover",
        status: "queued",
        created: 1,
        seriesCoverUrl:
          'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" />',
      }),
    ]

    const result = projectToQueueView(tasks)

    expect(result.queueView[0]?.coverUrl).toBe(
      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" />'
    )
  })

  it("limits history projection to the five most-recent terminal tasks", () => {
    const tasks: DownloadTaskState[] = [
      makeTask({ id: "t1", status: "failed", completed: 1 }),
      makeTask({ id: "t2", status: "failed", completed: 2 }),
      makeTask({ id: "t3", status: "failed", completed: 3 }),
      makeTask({ id: "t4", status: "failed", completed: 4 }),
      makeTask({ id: "t5", status: "failed", completed: 5 }),
      makeTask({ id: "t6", status: "failed", completed: 6 }),
    ]

    const result = projectToQueueView(tasks)

    expect(result.historyView.map((task) => task.id)).toEqual([
      "t6",
      "t5",
      "t4",
      "t3",
      "t2",
    ])
    expect(result.historyView).toHaveLength(5)
  })

  it("preserves queued task array order (supports moveTaskToTop reordering)", () => {
    const tasks: DownloadTaskState[] = [
      makeTask({ id: "active", status: "downloading", created: 1 }),
      makeTask({ id: "queued-moved-to-top", status: "queued", created: 100 }),
      makeTask({ id: "queued-original-first", status: "queued", created: 10 }),
      makeTask({ id: "queued-original-second", status: "queued", created: 50 }),
    ]

    const result = projectToQueueView(tasks)

    const queuedIds = result.queueView
      .filter((task) => task.status === "queued")
      .map((task) => task.id)

    expect(queuedIds).toEqual([
      "queued-moved-to-top",
      "queued-original-first",
      "queued-original-second",
    ])
  })

  it.each([
    [-999, ""],
    [0, ""],
    [1, "1"],
    [998, "998"],
    [999, "999"],
    [1_000, "999+"],
    [Number.MAX_SAFE_INTEGER, "999+"],
  ])("formats action badge count %s as %s", (count, expected) => {
    expect(getBadgeText(count)).toBe(expected)
  })

  it("returns without touching badge APIs when chrome.action is unavailable", async () => {
    vi.stubGlobal("chrome", {})

    await expect(updateActionBadge(3)).resolves.toBeUndefined()
  })
})
