import { describe, expect, it } from "vitest"

import {
  isExecutingDownloadTask,
  isRunnableQueuedTask,
  isWatchdogEligibleTask,
  normalizeDownloadTaskExecutionState,
} from "@/src/runtime/download-task-execution-state"
import type { DownloadTaskState } from "@/src/types/queue-state"

function createTask(
  overrides: Partial<DownloadTaskState> = {}
): DownloadTaskState {
  return {
    id: "task-1",
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Series",
    chapters: [],
    status: "queued",
    created: 100,
    settingsSnapshot: {} as DownloadTaskState["settingsSnapshot"],
    ...overrides,
  }
}

describe("download task execution semantics", () => {
  it("does not treat a logically blocked task as runnable or executing", () => {
    const blockedQueued = createTask({
      activeBlock: "provider_network_policy_pending",
    })
    const legacyBlockedDownloading = createTask({
      status: "downloading",
      activeBlock: "destination_action_required",
    })

    expect(isRunnableQueuedTask(blockedQueued)).toBe(false)
    expect(isExecutingDownloadTask(blockedQueued)).toBe(false)
    expect(isExecutingDownloadTask(legacyBlockedDownloading)).toBe(false)
    expect(isWatchdogEligibleTask(legacyBlockedDownloading)).toBe(false)
  })

  it("normalizes nonterminal blocked downloading state back to queued", () => {
    expect(
      normalizeDownloadTaskExecutionState(
        createTask({
          status: "downloading",
          activeBlock: "provider_network_policy_pending",
          started: 90,
        })
      )
    ).toMatchObject({
      status: "queued",
      activeBlock: "provider_network_policy_pending",
    })
  })

  it("clears execution-only metadata from terminal tasks", () => {
    const normalized = normalizeDownloadTaskExecutionState(
      createTask({
        status: "failed",
        activeBlock: "destination_action_required",
        browserDownloadWait: {
          downloadIds: [42],
          since: 100,
        },
      })
    )

    expect(normalized.activeBlock).toBeUndefined()
    expect(normalized.browserDownloadWait).toBeUndefined()
  })
})
