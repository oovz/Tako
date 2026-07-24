import { describe, expect, it } from "vitest"

import { getRetryAvailability } from "@/entrypoints/sidepanel/components/CommandCenterQueue"
import {
  getTaskActionAvailability,
  getTaskActionPlan,
  shouldConfirmTaskCancellation,
} from "@/entrypoints/sidepanel/components/command-center-queue-helpers"
import type { QueueTaskSummary } from "@/src/types/queue-state"

function makeTask(overrides: Partial<QueueTaskSummary>): QueueTaskSummary {
  return {
    id: "task-1",
    seriesKey: "mangadex#manga-1",
    seriesTitle: "Series 1",
    siteIntegration: "mangadex",
    status: "partial_success",
    chapters: { total: 3, completed: 2, unsuccessful: 1 },
    timestamps: { created: Date.now(), completed: Date.now() },
    failureCategory: undefined,
    isRetried: false,
    isRetryTask: false,
    lastSuccessfulDownloadId: undefined,
    ...overrides,
  }
}

describe("CommandCenterQueue retry availability policy", () => {
  it("allows retry for partial_success task with failed chapters and retry handler", () => {
    const task = makeTask({ status: "partial_success", isRetried: false })
    const result = getRetryAvailability(task, true)

    expect(result.canRetryFailed).toBe(true)
    expect(result.retryBlockedMessage).toBeNull()
  })

  it("blocks retry for already retried tasks", () => {
    const task = makeTask({ isRetried: true })
    const result = getRetryAvailability(task, true)

    expect(result.canRetryFailed).toBe(false)
  })

  it("blocks retry when no failed chapters remain", () => {
    const task = makeTask({
      chapters: { total: 3, completed: 3, unsuccessful: 0 },
    })
    const result = getRetryAvailability(task, true)

    expect(result.canRetryFailed).toBe(false)
  })

  it("blocks retry when no retry handler is available", () => {
    const task = makeTask({ status: "partial_success", isRetried: false })
    const result = getRetryAvailability(task, false)

    expect(result.canRetryFailed).toBe(false)
  })
})

describe("CommandCenterQueue action hierarchy", () => {
  const handlers = {
    hasCancelHandler: true,
    isCanceling: false,
    hasRestartHandler: true,
    hasMoveToTopHandler: true,
    hasRemoveHandler: true,
  }

  it("confirms active cancellation but makes queued cancellation undoable", () => {
    expect(shouldConfirmTaskCancellation("downloading")).toBe(true)
    expect(shouldConfirmTaskCancellation("queued")).toBe(false)
  })

  it("keeps active cancel visible as the only action", () => {
    const availability = getTaskActionAvailability(
      makeTask({ status: "downloading" }),
      handlers
    )
    expect(
      getTaskActionPlan("downloading", {
        ...availability,
        canRetryFailed: false,
      })
    ).toEqual({ primary: "cancel", overflow: [] })
  })

  it("hides meaningless Move to top for the first queued task", () => {
    const first = getTaskActionAvailability(makeTask({ status: "queued" }), {
      ...handlers,
      isFirstQueuedTask: true,
    })
    const later = getTaskActionAvailability(makeTask({ status: "queued" }), {
      ...handlers,
      isFirstQueuedTask: false,
    })

    expect(
      getTaskActionPlan("queued", { ...first, canRetryFailed: false })
    ).toEqual({ primary: null, overflow: ["cancel"] })
    expect(
      getTaskActionPlan("queued", { ...later, canRetryFailed: false })
    ).toEqual({ primary: "move-to-top", overflow: ["cancel"] })
  })

  it("uses Retry as the partial-success primary and keeps Restart/Remove secondary", () => {
    const availability = getTaskActionAvailability(
      makeTask({ status: "partial_success" }),
      handlers
    )
    expect(
      getTaskActionPlan("partial_success", {
        ...availability,
        canRetryFailed: true,
      })
    ).toEqual({
      primary: "retry-failed",
      overflow: ["restart", "remove"],
    })
  })

  it("uses Restart for failed/canceled tasks and only overflow for completed tasks", () => {
    for (const status of ["failed", "canceled"] as const) {
      const availability = getTaskActionAvailability(
        makeTask({ status }),
        handlers
      )
      expect(
        getTaskActionPlan(status, {
          ...availability,
          canRetryFailed: false,
        })
      ).toEqual({ primary: "restart", overflow: ["remove"] })
    }

    const completed = getTaskActionAvailability(
      makeTask({ status: "completed" }),
      handlers
    )
    expect(
      getTaskActionPlan("completed", {
        ...completed,
        canRetryFailed: false,
      })
    ).toEqual({ primary: null, overflow: ["remove"] })
  })
})
