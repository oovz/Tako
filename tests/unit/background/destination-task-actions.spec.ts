import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  handleContinueTaskInDownloads,
  handleRetryDestinationTask,
} from "@/entrypoints/background/action-handlers/download-task-handlers"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "@/src/storage/default-settings"
import type { DownloadTaskState } from "@/src/types/queue-state"

const mocks = vi.hoisted(() => ({
  clearDestinationIssuesForTask: vi.fn(),
}))

vi.mock("@/entrypoints/background/destination", () => ({
  clearDestinationIssuesForTask: mocks.clearDestinationIssuesForTask,
}))

vi.mock("@/src/runtime/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

function makeBlockedTask(
  overrides: Partial<DownloadTaskState> = {}
): DownloadTaskState {
  return {
    id: "task-1",
    siteIntegrationId: "test-site",
    mangaId: "series-1",
    seriesTitle: "Test Series",
    status: "downloading",
    activeBlock: "destination_action_required",
    destinationOverride: "downloads-api",
    errorMessage: "Folder unavailable",
    errorCategory: "folder_unavailable",
    created: 1,
    settingsSnapshot: {
      ...createTaskSettingsSnapshot(DEFAULT_SETTINGS, "test-site"),
      destination: "file-system-access",
    },
    chapters: [
      {
        id: "complete",
        url: "https://example.com/complete",
        title: "Complete",
        index: 1,
        status: "completed",
        lastUpdated: 1,
      },
      {
        id: "current",
        url: "https://example.com/current",
        title: "Current",
        index: 2,
        status: "downloading",
        errorMessage: "Folder unavailable",
        lastUpdated: 1,
      },
      {
        id: "next",
        url: "https://example.com/next",
        title: "Next",
        index: 3,
        status: "queued",
        errorMessage: "stale",
        lastUpdated: 1,
      },
    ],
    ...overrides,
  }
}

function createManager(queue: DownloadTaskState[]): CentralizedStateManager {
  return {
    updateDownloadQueueAtomically: vi.fn(async (update) => {
      const next = update(queue)
      queue.splice(0, queue.length, ...next.queue)
      return next.result
    }),
  } as unknown as CentralizedStateManager
}

describe("destination recovery task actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.clearDestinationIssuesForTask.mockResolvedValue(undefined)
  })

  it("retries the selected folder while preserving completed chapters", async () => {
    const queue = [makeBlockedTask()]

    const result = await handleRetryDestinationTask(createManager(queue), {
      taskId: "task-1",
    })

    expect(result).toEqual({ success: true })
    expect(queue[0]).toEqual(
      expect.objectContaining({
        status: "queued",
        activeBlock: undefined,
        destinationOverride: undefined,
        errorMessage: undefined,
        errorCategory: undefined,
      })
    )
    expect(queue[0]?.chapters.map((chapter) => chapter.status)).toEqual([
      "completed",
      "queued",
      "queued",
    ])
    expect(queue[0]?.chapters[1]?.errorMessage).toBeUndefined()
    expect(mocks.clearDestinationIssuesForTask).toHaveBeenCalledWith("task-1")
  })

  it("applies a task-scoped Downloads override without changing the snapshot", async () => {
    const queue = [makeBlockedTask({ destinationOverride: undefined })]

    const result = await handleContinueTaskInDownloads(createManager(queue), {
      taskId: "task-1",
    })

    expect(result).toEqual({ success: true })
    expect(queue[0]?.destinationOverride).toBe("downloads-api")
    expect(queue[0]?.settingsSnapshot.destination).toBe("file-system-access")
    expect(mocks.clearDestinationIssuesForTask).toHaveBeenCalledWith("task-1")
  })

  it("rejects tasks that are not waiting for destination action", async () => {
    const queue = [
      makeBlockedTask({ activeBlock: undefined, status: "queued" }),
    ]

    const result = await handleContinueTaskInDownloads(createManager(queue), {
      taskId: "task-1",
    })

    expect(result).toEqual({
      success: false,
      error: "This task is not waiting for download-folder action.",
    })
    expect(mocks.clearDestinationIssuesForTask).not.toHaveBeenCalled()
  })
})
