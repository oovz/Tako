import { describe, expect, it } from "vitest"

import {
  beginFsaWrite,
  failTaskForSave,
  selectChromeFallback,
} from "@/src/domain/queue/kernel"
import type {
  ActiveDispatchLease,
  DownloadTaskState,
  QueueAggregateState,
} from "@/src/domain/queue/state"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"

function fixture(): QueueAggregateState {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.downloads.destination = "file-system-access"
  settings.downloads.customDirectoryHandleId = "folder"
  settings.downloads.allowChromeFallback = true
  const task: DownloadTaskState = {
    id: "task",
    siteIntegrationId: "mangadex",
    mangaId: "series",
    seriesTitle: "Series",
    status: "downloading",
    created: 1,
    fsaFallbackEligible: true,
    settingsSnapshot: createTaskSettingsSnapshot(settings, "mangadex"),
    chapters: [
      {
        id: "chapter",
        title: "Chapter",
        index: 0,
        url: "https://example.com/chapter",
        requestedPath: "Chapter.cbz",
        status: "downloading",
        lastUpdated: 1,
      },
      {
        id: "next",
        title: "Next",
        index: 1,
        url: "https://example.com/next",
        requestedPath: "Next.cbz",
        status: "queued",
        lastUpdated: 1,
      },
    ],
  }
  const lease: ActiveDispatchLease = {
    jobId: "job",
    attempt: 1,
    taskId: "task",
    chapterId: "chapter",
    fingerprint: "a".repeat(64),
    documentInstanceId: "document",
    saveMode: "fsa",
    destinationHandleId: "folder",
    stage: "saving",
    startedAt: 1,
    lastActivityAt: 1,
    leaseExpiresAt: 10,
    sequence: 1,
  }
  return { queue: [task], lease, pendingUndoActions: [] }
}

function identity(state: QueueAggregateState) {
  if (!state.lease) throw new Error("fixture requires a dispatch lease")
  return { ...state.lease, documentInstanceId: "document" }
}

const failure = {
  taskId: "task",
  chapterId: "chapter",
  errorMessage: "Folder write failed",
  errorCategory: "folder_write_failed" as const,
  now: 20,
}

describe("folder transition ownership", () => {
  it("consumes fallback eligibility before a write and preserves the dispatch lease", () => {
    const initial = fixture()
    const begun = beginFsaWrite(initial, identity(initial))
    expect(begun.result.outcome).toBe("applied")
    expect(begun.next.queue[0]!.fsaFallbackEligible).toBeUndefined()
    expect(begun.next.lease).toBe(initial.lease)
    const replay = beginFsaWrite(begun.next, identity(initial))
    expect(replay.result.outcome).toBe("unchanged")
    expect(replay.next).toBe(begun.next)
    expect(
      selectChromeFallback(begun.next, {
        taskId: "task",
        terminalLease: identity(initial),
        now: 20,
      }).result
    ).toEqual({ outcome: "rejected", reason: "fallback-unavailable" })
  })

  it("requires exact producer and folder ownership at both fallback boundaries", () => {
    const initial = fixture()
    const wrongFolder = {
      ...initial,
      lease: { ...initial.lease!, destinationHandleId: "other-folder" },
    }
    expect(
      beginFsaWrite(wrongFolder, identity(wrongFolder)).result.outcome
    ).toBe("rejected")
    expect(
      selectChromeFallback(wrongFolder, {
        taskId: "task",
        terminalLease: identity(wrongFolder),
        now: 20,
      }).result.outcome
    ).toBe("rejected")
    expect(
      beginFsaWrite(initial, {
        ...identity(initial),
        documentInstanceId: "other-document",
      }).result.outcome
    ).toBe("rejected")
    expect(
      selectChromeFallback(initial, { taskId: "task", now: 20 }).result.outcome
    ).toBe("rejected")
    expect(
      selectChromeFallback(initial, {
        taskId: "task",
        terminalLease: { ...identity(initial), chapterId: "next" },
        now: 20,
      }).result.outcome
    ).toBe("rejected")
    const switched = selectChromeFallback(initial, {
      taskId: "task",
      terminalLease: identity(initial),
      now: 20,
    })
    expect(switched.result.outcome).toBe("applied")
    expect(switched.next.lease).toBeNull()
    expect(switched.next.queue[0]).toMatchObject({
      useChromeFallback: true,
      status: "queued",
    })
    expect(
      switched.next.queue[0]!.chapters.map((chapter) => chapter.status)
    ).toEqual(["queued", "queued"])
    expect(initial.queue[0]!.settingsSnapshot.destination.kind).toBe(
      "file-system-access"
    )
  })

  it("fails partial folder output atomically with its exact terminal lease", () => {
    const initial = fixture()
    initial.queue[0]!.chapters[0]!.outputs = {
      requested: 3,
      committed: 1,
      failed: 0,
    }
    const result = failTaskForSave(initial, {
      ...failure,
      clearLease: identity(initial),
      outputs: { requested: 3, committed: 0, failed: 2 },
    })
    expect(result.result).toMatchObject({
      outcome: "applied",
      clearedLease: initial.lease,
      task: { status: "partial_success", errorMessage: failure.errorMessage },
    })
    expect(result.next.lease).toBeNull()
    expect(result.next.queue[0]!.chapters[0]).toMatchObject({
      status: "partial_success",
      outputs: { requested: 3, committed: 1, failed: 2 },
      outputDestination: "fsa",
    })
    expect(result.next.queue[0]!.chapters[1]!.status).toBe("skipped")
    expect(initial.queue[0]!.chapters[1]!.status).toBe("queued")
    expect(
      failTaskForSave(initial, {
        ...failure,
        clearLease: { ...identity(initial), documentInstanceId: "stale" },
      }).result
    ).toEqual({ outcome: "rejected", reason: "lease-conflict" })
  })

  it("chooses pending work and retains a producer lease when cancellation is unconfirmed", () => {
    const initial = fixture()
    const failed = failTaskForSave(initial, {
      ...failure,
      chapterId: undefined,
    })
    expect(failed.result.outcome).toBe("applied")
    expect(failed.next.queue[0]!.status).toBe("failed")
    expect(failed.next.lease).toBe(initial.lease)
    initial.queue[0]!.chapters[0]!.status = "completed"
    const nextFailure = failTaskForSave(initial, {
      ...failure,
      chapterId: undefined,
    })
    expect(nextFailure.next.queue[0]!.status).toBe("partial_success")
    expect(nextFailure.next.queue[0]!.chapters[1]!.status).toBe("failed")
    expect(failTaskForSave(initial, failure).result).toEqual({
      outcome: "rejected",
      reason: "chapter-not-pending",
    })
    expect(
      failTaskForSave(initial, { ...failure, taskId: "missing" }).result
    ).toEqual({ outcome: "rejected", reason: "task-not-found" })
    expect(failTaskForSave(failed.next, failure).result).toEqual({
      outcome: "rejected",
      reason: "task-not-active",
    })
  })
})
