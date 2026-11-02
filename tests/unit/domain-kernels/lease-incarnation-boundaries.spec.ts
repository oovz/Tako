import { describe, expect, it } from "vitest"

import {
  bindDispatchLeaseIncarnation,
  renewDispatchLease,
} from "@/src/domain/queue/kernel"
import type {
  ActiveDispatchLease,
  QueueAggregateState,
} from "@/src/domain/queue/state"

const lease: ActiveDispatchLease = {
  jobId: "job",
  attempt: 1,
  taskId: "task",
  chapterId: "chapter",
  fingerprint: "a".repeat(64),
  saveMode: "downloads-api",
  stage: "dispatching",
  startedAt: 1,
  lastActivityAt: 1,
  leaseExpiresAt: 45_001,
  sequence: 0,
}

function state(
  current: ActiveDispatchLease | null = lease
): QueueAggregateState {
  return { queue: [], pendingUndoActions: [], lease: current }
}

const binding = { ...lease, documentInstanceId: "document" }

describe("dispatch lease incarnation ownership", () => {
  it("binds one document and converges identical replays without rebinding ownership", () => {
    const initial = state()
    const bound = bindDispatchLeaseIncarnation(initial, binding)
    expect(bound.result).toMatchObject({
      outcome: "applied",
      lease: { documentInstanceId: "document" },
    })
    expect(bound.changedKeys).toEqual(["lease"])
    expect(initial.lease?.documentInstanceId).toBeUndefined()
    const replay = bindDispatchLeaseIncarnation(bound.next, binding)
    expect(replay.result.outcome).toBe("unchanged")
    expect(replay.next).toBe(bound.next)
    const conflict = bindDispatchLeaseIncarnation(bound.next, {
      ...binding,
      documentInstanceId: "replacement",
    })
    expect(conflict.result).toEqual({
      outcome: "rejected",
      reason: "incarnation-conflict",
    })
    expect(conflict.next).toBe(bound.next)
  })

  it("rejects missing leases and stale producer identities before binding", () => {
    for (const initial of [
      state(null),
      state({ ...lease, jobId: "replacement" }),
      state({ ...lease, fingerprint: "b".repeat(64) }),
    ]) {
      const result = bindDispatchLeaseIncarnation(initial, binding)
      expect(result.result).toEqual({
        outcome: "rejected",
        reason: "lease-not-current",
      })
      expect(result.next).toBe(initial)
    }
  })

  it("requires the bound document for progress and rejects conflicting event replays", () => {
    const bound = bindDispatchLeaseIncarnation(state(), binding).next
    const progress = {
      ...binding,
      eventSignature: "event",
      stage: "accepted" as const,
      sequence: 1,
      activityAt: 2,
    }
    expect(renewDispatchLease(state(), progress).result).toEqual({
      outcome: "rejected",
      reason: "lease-not-current",
    })
    const accepted = renewDispatchLease(bound, progress)
    expect(accepted.result.outcome).toBe("applied")
    const staleDocument = renewDispatchLease(accepted.next, {
      ...progress,
      documentInstanceId: "replacement",
      sequence: 2,
    })
    expect(staleDocument.result).toEqual({
      outcome: "rejected",
      reason: "lease-not-current",
    })
    const conflictingReplay = renewDispatchLease(accepted.next, {
      ...progress,
      eventSignature: "different",
    })
    expect(conflictingReplay.result).toEqual({
      outcome: "rejected",
      reason: "sequence-conflict",
    })
    expect(conflictingReplay.next).toBe(accepted.next)
  })
})
