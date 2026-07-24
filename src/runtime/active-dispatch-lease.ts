import { OFFSCREEN_JOB_LEASE_MS } from "@/src/constants/timeouts"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type {
  ActiveDispatchLease,
  OffscreenJobStage,
} from "@/src/types/queue-state"
import { runDispatchPersistenceExclusive } from "@/src/runtime/dispatch-persistence-gate"

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

export function normalizeActiveDispatchLease(
  value: unknown
): ActiveDispatchLease | null {
  if (!value || typeof value !== "object") return null
  const candidate = value as Partial<ActiveDispatchLease>
  const stages: readonly OffscreenJobStage[] = [
    "dispatching",
    "accepted",
    "resolving",
    "downloading",
    "transforming",
    "archiving",
    "saving",
  ]
  if (
    typeof candidate.jobId !== "string" ||
    candidate.jobId.length === 0 ||
    typeof candidate.taskId !== "string" ||
    candidate.taskId.length === 0 ||
    typeof candidate.chapterId !== "string" ||
    candidate.chapterId.length === 0 ||
    !isPositiveInteger(candidate.attempt) ||
    !stages.includes(candidate.stage as OffscreenJobStage) ||
    !isFiniteTimestamp(candidate.startedAt) ||
    !isFiniteTimestamp(candidate.lastActivityAt) ||
    !isFiniteTimestamp(candidate.leaseExpiresAt) ||
    !isPositiveInteger(candidate.sequence)
  ) {
    return null
  }
  return candidate as ActiveDispatchLease
}

export function createDispatchLease(input: {
  jobId: string
  taskId: string
  chapterId: string
  attempt: number
  now?: number
}): ActiveDispatchLease {
  const now = input.now ?? Date.now()
  return {
    jobId: input.jobId,
    taskId: input.taskId,
    chapterId: input.chapterId,
    attempt: input.attempt,
    stage: "dispatching",
    startedAt: now,
    lastActivityAt: now,
    leaseExpiresAt: now + OFFSCREEN_JOB_LEASE_MS,
    sequence: 0,
  }
}

export interface ActiveDispatchLeaseStore {
  get: () => Promise<ActiveDispatchLease | null>
  set: (lease: ActiveDispatchLease) => Promise<void>
  renew: (input: {
    jobId: string
    attempt: number
    stage: OffscreenJobStage
    sequence: number
    activityAt?: number
    requireSequenceAdvance?: boolean
  }) => Promise<boolean>
  clear: (identity?: { jobId: string; attempt: number }) => Promise<boolean>
}

export function createActiveDispatchLeaseStore(): ActiveDispatchLeaseStore {
  let mutationChain: Promise<unknown> = Promise.resolve()

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = mutationChain
      .catch(() => undefined)
      .then(() => runDispatchPersistenceExclusive(operation))
    mutationChain = next
    return next
  }

  const read = async (): Promise<ActiveDispatchLease | null> => {
    const stored = await chrome.storage.local.get(
      LOCAL_STORAGE_KEYS.activeDispatchLease
    )
    return normalizeActiveDispatchLease(
      stored[LOCAL_STORAGE_KEYS.activeDispatchLease]
    )
  }

  return {
    async get() {
      await mutationChain.catch(() => undefined)
      return runDispatchPersistenceExclusive(read)
    },
    async set(lease) {
      await enqueue(async () => {
        await chrome.storage.local.set({
          [LOCAL_STORAGE_KEYS.activeDispatchLease]: lease,
        })
      })
    },
    async renew(input) {
      return enqueue(async () => {
        const current = await read()
        if (
          !current ||
          current.jobId !== input.jobId ||
          current.attempt !== input.attempt ||
          input.sequence < current.sequence ||
          !isFiniteTimestamp(input.activityAt ?? Date.now())
        ) {
          return false
        }
        if (input.sequence === current.sequence) {
          return (
            input.stage === current.stage &&
            input.requireSequenceAdvance !== true
          )
        }
        const activityAt = input.activityAt ?? Date.now()
        await chrome.storage.local.set({
          [LOCAL_STORAGE_KEYS.activeDispatchLease]: {
            ...current,
            stage: input.stage,
            sequence: input.sequence,
            lastActivityAt: Math.max(current.lastActivityAt, activityAt),
            leaseExpiresAt:
              Math.max(current.lastActivityAt, activityAt) +
              OFFSCREEN_JOB_LEASE_MS,
          } satisfies ActiveDispatchLease,
        })
        return true
      })
    },
    async clear(identity) {
      return enqueue(async () => {
        const current = await read()
        if (!current) return false
        if (
          identity &&
          (current.jobId !== identity.jobId ||
            current.attempt !== identity.attempt)
        ) {
          return false
        }
        await chrome.storage.local.remove(
          LOCAL_STORAGE_KEYS.activeDispatchLease
        )
        return true
      })
    },
  }
}

export const activeDispatchLeaseStore = createActiveDispatchLeaseStore()
