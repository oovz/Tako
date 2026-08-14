import { describe, expect, it } from "vitest"

import {
  planQueueScheduling,
  planStartupQueueActivation,
} from "@/src/domain/queue/scheduler-policy"
import type {
  ActiveDispatchLease,
  DownloadTaskState,
} from "@/src/domain/queue/state"

function task(
  id: string,
  status: DownloadTaskState["status"],
  activeBlock?: DownloadTaskState["activeBlock"]
): DownloadTaskState {
  return {
    id,
    status,
    activeBlock,
  } as unknown as DownloadTaskState
}

const lease: ActiveDispatchLease = {
  jobId: "job",
  attempt: 1,
  taskId: "active",
  chapterId: "active-chapter",
  fingerprint: "a".repeat(64),
  saveMode: "fsa",
  stage: "downloading",
  startedAt: 1,
  sequence: 1,
  lastEventSignature: "event",
  lastActivityAt: 1,
  leaseExpiresAt: 2,
}

describe("queue scheduler policy", () => {
  it("reports a fully idle queue as drained", () => {
    expect(
      planQueueScheduling({
        queue: [],
        activeLease: null,
      })
    ).toEqual({ kind: "drained" })
  })

  it("waits while an offscreen task or dispatch lease owns the serial slot", () => {
    const queued = task("queued", "queued")
    expect(
      planQueueScheduling({
        queue: [task("active", "downloading"), queued],
        activeLease: null,
      })
    ).toEqual({ kind: "wait" })
    expect(
      planQueueScheduling({
        queue: [queued],
        activeLease: lease,
      })
    ).toEqual({ kind: "wait" })
  })

  it("waits for browser-native output before starting another task", () => {
    expect(
      planQueueScheduling({
        queue: [
          task("blocked", "queued", "destination_action_required"),
          task("native", "downloading"),
          task("next", "queued"),
        ],
        activeLease: null,
      })
    ).toEqual({ kind: "wait" })
  })
})

describe("startup queue activation policy", () => {
  it("prioritizes the exact recovered task", () => {
    expect(
      planStartupQueueActivation({
        queue: [task("queued", "queued")],
        resumeTaskId: "recovered",
        activeLease: lease,
        offscreenActiveTaskIds: ["other"],
      })
    ).toEqual({ kind: "resume-task", taskId: "recovered" })
  })

  it("processes a runnable queue only when no offscreen authority remains", () => {
    const queue = [task("queued", "queued")]
    expect(
      planStartupQueueActivation({
        queue,
        activeLease: null,
        offscreenActiveTaskIds: [],
      })
    ).toEqual({ kind: "process-queue" })
    expect(
      planStartupQueueActivation({
        queue,
        activeLease: lease,
        offscreenActiveTaskIds: [],
      })
    ).toBeUndefined()
    expect(
      planStartupQueueActivation({
        queue,
        activeLease: null,
        offscreenActiveTaskIds: ["active"],
      })
    ).toBeUndefined()
  })
})
