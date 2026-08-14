import { OFFSCREEN_JOB_LEASE_MS } from "@/src/constants/timeouts"
import type { ActiveDispatchLease } from "@/src/domain/queue/state"

export function createDispatchLease(input: {
  jobId: string
  taskId: string
  chapterId: string
  attempt: number
  fingerprint: string
  saveMode: "fsa" | "downloads-api"
  now?: number
}): ActiveDispatchLease {
  const now = input.now ?? Date.now()
  return {
    jobId: input.jobId,
    taskId: input.taskId,
    chapterId: input.chapterId,
    attempt: input.attempt,
    fingerprint: input.fingerprint,
    saveMode: input.saveMode,
    stage: "dispatching",
    startedAt: now,
    lastActivityAt: now,
    leaseExpiresAt: now + OFFSCREEN_JOB_LEASE_MS,
    sequence: 0,
  }
}
