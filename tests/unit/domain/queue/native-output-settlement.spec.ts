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
  surrendered: 0,
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

  it("settles surrendered outputs as unknown instead of complete or interrupted", () => {
    const surrenderedSettlement = {
      ...settlement,
      requested: 3,
      completed: 1,
      interrupted: 0,
      surrendered: 2,
    }
    const applied = applyNativeOutputSettlement(state(), surrenderedSettlement)
    expect(applied.result).toMatchObject({
      outcome: "applied",
      chapter: {
        status: "partial_success",
        errorCategory: "browser_download_unobservable",
        outputs: { requested: 3, committed: 1, failed: 2 },
        nativeOutputSettlement: {
          completed: 1,
          interrupted: 0,
          surrendered: 2,
        },
      },
    })
    if (applied.result.outcome !== "applied") {
      throw new Error("expected settlement")
    }
    expect(applied.result.chapter.errorMessage).toContain("2")
    expect(applied.result.chapter.errorMessage).toContain(
      "Chrome cleared their download history"
    )

    const replay = applyNativeOutputSettlement(applied.next, {
      ...surrenderedSettlement,
      now: 999,
    })
    expect(replay.result).toMatchObject({ outcome: "already_applied" })
  })

  it("marks an all-surrendered chapter as failed with the unobservable category", () => {
    const applied = applyNativeOutputSettlement(state(), {
      ...settlement,
      requested: 2,
      completed: 0,
      interrupted: 0,
      surrendered: 2,
    })
    expect(applied.result).toMatchObject({
      outcome: "applied",
      chapter: {
        status: "failed",
        errorCategory: "browser_download_unobservable",
        outputs: { requested: 2, committed: 0, failed: 2 },
      },
      task: {
        status: "failed",
        errorCategory: "browser_download_unobservable",
      },
    })
  })

  it("prefers the unobservable category when interruption and surrender coexist", () => {
    const applied = applyNativeOutputSettlement(state(), {
      ...settlement,
      requested: 4,
      completed: 1,
      interrupted: 1,
      surrendered: 2,
    })
    expect(applied.result).toMatchObject({
      outcome: "applied",
      chapter: {
        status: "partial_success",
        errorCategory: "browser_download_unobservable",
        outputs: { requested: 4, committed: 1, failed: 3 },
      },
    })
  })

  it("rejects totals that do not include surrendered", () => {
    expect(
      applyNativeOutputSettlement(state(), {
        ...settlement,
        requested: 3,
        completed: 2,
        interrupted: 0,
        surrendered: 2,
      }).result
    ).toEqual({ outcome: "conflict", reason: "invalid-totals" })
  })
})
