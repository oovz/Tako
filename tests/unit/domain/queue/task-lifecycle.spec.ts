import { describe, expect, it } from "vitest"

import {
  cancelDownloadingTask,
  isExecutingDownloadTask,
  isLogicallyBlockedTask,
  isRunnableQueuedTask,
  isTerminalChapterStatus,
  isTerminalDownloadTask,
  isWatchdogEligibleTask,
  materializeCanceledChapters,
  materializeChapterDispatchOutcomes,
  normalizeDownloadTaskExecutionState,
  normalizeInterruptedChapter,
  normalizeInterruptedTask,
  resolveFinalDownloadTaskStatus,
  type ChapterDispatchOutcome,
} from "@/src/domain/queue/task-lifecycle"
import type { DownloadTaskState, TaskChapter } from "@/src/domain/queue/state"
import type { ChapterStatus } from "@/src/types/chapter"

function createChapter(
  status: ChapterStatus,
  overrides: Partial<TaskChapter> = {}
): TaskChapter {
  return {
    id: `chapter-${status}`,
    url: `https://example.com/${status}`,
    title: status,
    index: 1,
    status,
    lastUpdated: 10,
    ...overrides,
  }
}

function createTask(
  overrides: Partial<DownloadTaskState> = {}
): DownloadTaskState {
  return {
    id: "task-1",
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Series",
    chapters: [createChapter("queued")],
    status: "queued",
    created: 1,
    settingsSnapshot: {} as DownloadTaskState["settingsSnapshot"],
    ...overrides,
  }
}

describe("queue task lifecycle formulas", () => {
  it.each([
    ["queued", false],
    ["downloading", false],
    ["completed", true],
    ["partial_success", true],
    ["failed", true],
    ["canceled", true],
  ] as const)(
    "classifies task status %s as terminal=%s",
    (status, expected) => {
      expect(isTerminalDownloadTask({ status })).toBe(expected)
    }
  )

  it.each([
    ["queued", false],
    ["downloading", false],
    ["completed", true],
    ["partial_success", true],
    ["failed", true],
    ["canceled", true],
    ["skipped", true],
  ] as const)(
    "classifies chapter status %s as terminal=%s",
    (status, expected) => {
      expect(isTerminalChapterStatus(status)).toBe(expected)
    }
  )

  it.each([
    {
      name: "unblocked queued",
      task: createTask(),
      blocked: false,
      runnable: true,
      executing: false,
      watchdog: false,
    },
    {
      name: "blocked queued",
      task: createTask({ activeBlock: "destination_action_required" }),
      blocked: true,
      runnable: false,
      executing: false,
      watchdog: false,
    },
    {
      name: "unblocked downloading",
      task: createTask({ status: "downloading" }),
      blocked: false,
      runnable: false,
      executing: true,
      watchdog: true,
    },
    {
      name: "blocked downloading",
      task: createTask({
        status: "downloading",
        activeBlock: "provider_network_policy_pending",
      }),
      blocked: true,
      runnable: false,
      executing: false,
      watchdog: false,
    },
    {
      name: "terminal with stale block",
      task: createTask({
        status: "failed",
        activeBlock: "destination_action_required",
      }),
      blocked: false,
      runnable: false,
      executing: false,
      watchdog: false,
    },
  ])(
    "derives execution predicates for $name",
    ({ task, blocked, runnable, executing, watchdog }) => {
      expect(isLogicallyBlockedTask(task)).toBe(blocked)
      expect(isRunnableQueuedTask(task)).toBe(runnable)
      expect(isExecutingDownloadTask(task)).toBe(executing)
      expect(isWatchdogEligibleTask(task)).toBe(watchdog)
    }
  )

  it("normalizes blocked execution and terminal-only metadata without mutating input", () => {
    const blocked = createTask({
      status: "downloading",
      activeBlock: "provider_network_policy_pending",
    })
    const terminal = createTask({
      status: "failed",
      activeBlock: "destination_action_required",
    })
    const untouched = createTask()

    expect(normalizeDownloadTaskExecutionState(blocked)).toMatchObject({
      status: "queued",
      activeBlock: "provider_network_policy_pending",
    })
    expect(normalizeDownloadTaskExecutionState(terminal)).toMatchObject({
      status: "failed",
      activeBlock: undefined,
    })
    expect(normalizeDownloadTaskExecutionState(untouched)).toBe(untouched)
    expect(blocked.status).toBe("downloading")
    expect(terminal.activeBlock).toBe("destination_action_required")
  })

  it.each([
    {
      name: "queued",
      chapter: createChapter("queued"),
      expected: {
        status: "failed",
        errorMessage: "Interrupted",
        errorCategory: "unknown",
        lastUpdated: 500,
      },
    },
    {
      name: "downloading without committed output",
      chapter: createChapter("downloading", {
        outputs: { requested: 2, committed: 0, failed: 0 },
      }),
      expected: {
        status: "failed",
        errorMessage: "Interrupted",
        errorCategory: "unknown",
        lastUpdated: 500,
      },
    },
    {
      name: "downloading with partial output",
      chapter: createChapter("downloading", {
        outputs: { requested: 4, committed: 2, failed: 1 },
      }),
      expected: {
        status: "partial_success",
        errorMessage: "Interrupted",
        errorCategory: "unknown",
        outputs: { requested: 4, committed: 2, failed: 2 },
        lastUpdated: 500,
      },
    },
    {
      name: "downloading with complete output",
      chapter: createChapter("downloading", {
        errorMessage: "stale",
        errorCategory: "unknown",
        outputs: { requested: 2, committed: 2, failed: 0 },
      }),
      expected: {
        status: "completed",
        errorMessage: undefined,
        errorCategory: undefined,
        outputs: { requested: 2, committed: 2, failed: 0 },
        lastUpdated: 500,
      },
    },
  ])("normalizes an interrupted $name chapter", ({ chapter, expected }) => {
    const before = structuredClone(chapter)

    expect(normalizeInterruptedChapter(chapter, "Interrupted", 500)).toEqual({
      ...chapter,
      ...expected,
    })
    expect(chapter).toEqual(before)
  })

  it.each([
    "completed",
    "partial_success",
    "failed",
    "canceled",
    "skipped",
  ] as const)("leaves terminal %s chapters unchanged", (status) => {
    const chapter = createChapter(status)
    expect(normalizeInterruptedChapter(chapter, "Interrupted", 500)).toBe(
      chapter
    )
  })

  it.each([
    {
      name: "all completed",
      chapters: [createChapter("completed"), createChapter("completed")],
      status: "completed",
      errorMessage: undefined,
      errorCategory: undefined,
    },
    {
      name: "completed plus interrupted",
      chapters: [createChapter("completed"), createChapter("queued")],
      status: "partial_success",
      errorMessage: "Interrupted",
      errorCategory: "unknown",
    },
    {
      name: "partial plus interrupted",
      chapters: [
        createChapter("partial_success"),
        createChapter("downloading"),
      ],
      status: "partial_success",
      errorMessage: "Interrupted",
      errorCategory: "unknown",
    },
    {
      name: "only interrupted",
      chapters: [createChapter("queued"), createChapter("downloading")],
      status: "failed",
      errorMessage: "Interrupted",
      errorCategory: "unknown",
    },
    {
      name: "no chapters",
      chapters: [],
      status: "failed",
      errorMessage: "Interrupted",
      errorCategory: "unknown",
    },
  ] as const)(
    "normalizes an interrupted task with $name",
    ({ chapters, status, errorMessage, errorCategory }) => {
      const task = createTask({
        status: "downloading",
        chapters: [...chapters],
        activeBlock: "destination_action_required",
      })
      const before = structuredClone(task)

      const normalized = normalizeInterruptedTask(task, "Interrupted", 500)

      expect(normalized).toMatchObject({
        status,
        completed: 500,
        errorMessage,
        errorCategory,
        activeBlock: undefined,
      })
      expect(task).toEqual(before)
    }
  )

  it("preserves an existing task completion timestamp during interruption normalization", () => {
    const normalized = normalizeInterruptedTask(
      createTask({ status: "downloading", completed: 77 }),
      "Interrupted",
      500
    )
    expect(normalized.completed).toBe(77)
  })

  it("materializes active-task cancellation once for every chapter status", () => {
    const chapters = (
      [
        "queued",
        "downloading",
        "completed",
        "partial_success",
        "failed",
        "canceled",
        "skipped",
      ] as const
    ).map((status, index) => createChapter(status, { index }))
    const task = createTask({
      status: "downloading",
      chapters,
      activeBlock: "destination_action_required",
    })
    const before = structuredClone(task)

    const materializedChapters = materializeCanceledChapters(chapters, 500)
    const canceled = cancelDownloadingTask(task, 500)

    expect(materializedChapters.map((chapter) => chapter.status)).toEqual([
      "skipped",
      "canceled",
      "completed",
      "partial_success",
      "failed",
      "canceled",
      "skipped",
    ])
    expect(materializedChapters[0]).toMatchObject({
      errorMessage: "Skipped after task cancellation",
      lastUpdated: 500,
    })
    expect(materializedChapters[1]).toMatchObject({
      errorMessage: "Canceled by user",
      lastUpdated: 500,
    })
    expect(canceled).toMatchObject({
      status: "canceled",
      completed: 500,
      activeBlock: undefined,
    })
    expect(canceled.chapters).toEqual(materializedChapters)
    expect(task).toEqual(before)
  })

  it("materializes missing chapter outcomes with stable identities", () => {
    const task = createTask({
      chapters: [
        createChapter("downloading", { id: "known-chapter" }),
        createChapter("queued", { id: "" }),
      ],
    })
    const completed: ChapterDispatchOutcome = {
      chapterId: "known-chapter",
      status: "completed",
    }

    expect(
      materializeChapterDispatchOutcomes(task, [
        completed,
        undefined,
        undefined,
      ])
    ).toEqual([
      completed,
      {
        chapterId: "unknown-chapter-2",
        status: "failed",
        errorMessage: "Chapter did not complete dispatch",
        errorCategory: "unknown",
      },
      {
        chapterId: "unknown-chapter-3",
        status: "failed",
        errorMessage: "Chapter did not complete dispatch",
        errorCategory: "unknown",
      },
    ])
  })

  it.each([
    [[], "completed"],
    [["completed"], "completed"],
    [["completed", "completed"], "completed"],
    [["partial_success"], "partial_success"],
    [["completed", "partial_success"], "partial_success"],
    [["completed", "failed"], "partial_success"],
    [["partial_success", "failed"], "partial_success"],
    [["failed"], "failed"],
    [["failed", "failed"], "failed"],
  ] as const)("resolves final status for %j as %s", (statuses, expected) => {
    const outcomes = statuses.map((status, index) => ({
      chapterId: `chapter-${index}`,
      status,
    }))
    expect(resolveFinalDownloadTaskStatus(outcomes)).toBe(expected)
  })
})
