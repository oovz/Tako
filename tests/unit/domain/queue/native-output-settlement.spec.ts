import { describe, expect, it } from "vitest"

import { applyNativeOutputSettlement } from "@/src/domain/queue/kernel"
import type {
  ActiveDispatchLease,
  DownloadTaskState,
  QueueAggregateState,
} from "@/src/domain/queue/state"

function task(overrides: Partial<DownloadTaskState> = {}): DownloadTaskState {
  return {
    id: "task-1",
    siteIntegrationId: "mangadex",
    mangaId: "series-1",
    seriesTitle: "Series",
    chapters: [
      {
        requestedPath: "Tako/Chapter.cbz",
        id: "chapter-1",
        url: "https://example.com/chapter-1",
        title: "Chapter 1",
        index: 1,
        status: "downloading",
        dispatchAttempt: 2,
        lastUpdated: 1,
      },
    ],
    status: "downloading",
    created: 1,
    settingsSnapshot: {} as DownloadTaskState["settingsSnapshot"],
    ...overrides,
  }
}

function lease(
  overrides: Partial<ActiveDispatchLease> = {}
): ActiveDispatchLease {
  return {
    jobId: "job-1",
    attempt: 2,
    fingerprint: "a".repeat(64),
    documentInstanceId: "document-instance-1",
    saveMode: "downloads-api",
    taskId: "task-1",
    chapterId: "chapter-1",
    stage: "saving",
    startedAt: 1,
    lastActivityAt: 2,
    leaseExpiresAt: 3,
    sequence: 4,
    ...overrides,
  }
}

const settlement = {
  jobId: "job-1",
  attempt: 2,
  taskId: "task-1",
  chapterId: "chapter-1",
  requested: 3,
  completed: 2,
  interrupted: 1,
  lastSuccessfulDownloadId: 42,
  now: 10,
}

function state(
  queue: DownloadTaskState[] = [task()],
  activeLease: ActiveDispatchLease | null = null
): QueueAggregateState {
  return { queue, lease: activeLease, pendingUndoActions: [] }
}

describe("applyNativeOutputSettlement", () => {
  it("applies exact totals and proves an identical replay after lease clear", () => {
    const applied = applyNativeOutputSettlement(state(), settlement)
    expect(applied.result).toMatchObject({
      outcome: "applied",
      chapter: {
        outputs: { requested: 3, committed: 2, failed: 1 },
      },
    })
    const replayed = applyNativeOutputSettlement(applied.next, {
      ...settlement,
      now: 999,
    })
    expect(replayed.result).toMatchObject({ outcome: "already_applied" })
    expect(replayed.next).toBe(applied.next)
  })

  it("fences producer failures during settlement replay", () => {
    const failure = {
      ...settlement,
      acceptanceUncertain: true as const,
      errorMessage: "Archive worker failed",
      errorCategory: "archive_creation_failed" as const,
    }
    const applied = applyNativeOutputSettlement(state(), failure)
    expect(applied.result).toMatchObject({
      outcome: "applied",
      chapter: {
        status: "partial_success",
        errorMessage: failure.errorMessage,
        errorCategory: failure.errorCategory,
        nativeOutputSettlement: { acceptanceUncertain: true },
      },
    })
    expect(
      applyNativeOutputSettlement(applied.next, failure).result.outcome
    ).toBe("already_applied")
    expect(
      applyNativeOutputSettlement(applied.next, {
        ...failure,
        errorMessage: "A later cleanup error",
      }).result
    ).toEqual({ outcome: "conflict", reason: "settlement-conflict" })
  })

  it("clears earlier chapter and task failures after every handoff succeeds", () => {
    const active = task({
      errorMessage: "Old failure",
      errorCategory: "unknown",
    })
    active.chapters[0] = {
      ...active.chapters[0],
      errorMessage: "Old failure",
      errorCategory: "unknown",
    }
    const applied = applyNativeOutputSettlement(state([active]), {
      ...settlement,
      completed: 3,
      interrupted: 0,
    })
    expect(applied.result.outcome).toBe("applied")
    expect(applied.next.queue[0].status).toBe("completed")
    expect(applied.next.queue[0].errorMessage).toBeUndefined()
    expect(applied.next.queue[0].errorCategory).toBeUndefined()
    expect(applied.next.queue[0].chapters[0].errorMessage).toBeUndefined()
    expect(applied.next.queue[0].chapters[0].errorCategory).toBeUndefined()
  })

  it("rejects invalid totals and conflicting replays without mutation", () => {
    expect(
      applyNativeOutputSettlement(state(), {
        ...settlement,
        interrupted: 2,
      }).result
    ).toEqual({ outcome: "conflict", reason: "invalid-totals" })

    const applied = applyNativeOutputSettlement(state(), settlement)
    expect(
      applyNativeOutputSettlement(applied.next, {
        ...settlement,
        completed: 1,
        interrupted: 2,
      }).result
    ).toEqual({ outcome: "conflict", reason: "settlement-conflict" })
  })

  it("reports not_owner only for provably terminal or missing ownership", () => {
    expect(applyNativeOutputSettlement(state([]), settlement).result).toEqual({
      outcome: "not_owner",
      reason: "task-missing",
    })
    expect(
      applyNativeOutputSettlement(
        state([task({ status: "canceled" })], null),
        settlement
      ).result
    ).toEqual({ outcome: "not_owner", reason: "task-canceled" })
  })

  it("blocks cleanup when an active lease or attempt conflicts", () => {
    expect(
      applyNativeOutputSettlement(state([task()], lease()), settlement).result
    ).toEqual({ outcome: "conflict", reason: "lease-conflict" })

    const differentAttempt = task({
      chapters: [
        {
          ...task().chapters[0]!,
          dispatchAttempt: 3,
        },
      ],
    })
    expect(
      applyNativeOutputSettlement(state([differentAttempt], null), settlement)
        .result
    ).toEqual({ outcome: "conflict", reason: "active-attempt-conflict" })
  })

  it("completes a chapter when every requested file is acknowledged", () => {
    expect(
      applyNativeOutputSettlement(state(), {
        ...settlement,
        completed: 3,
        interrupted: 0,
      }).result
    ).toMatchObject({
      outcome: "applied",
      chapter: {
        status: "completed",
        outputDestination: "downloads-api",
        outputs: { requested: 3, committed: 3, failed: 0 },
      },
    })
  })
})
