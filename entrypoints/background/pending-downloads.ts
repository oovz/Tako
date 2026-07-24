import {
  LOCAL_STORAGE_KEYS,
  SESSION_STORAGE_KEYS,
} from "@/src/runtime/storage-keys"
import type { PendingOutputRecord } from "@/src/types/queue-state"

export interface PendingOutputSummary {
  requested: number
  committed: number
  failed: number
  completedDownloadIds: number[]
}

export interface PendingDownloadsStore {
  hydrate: () => Promise<void>
  get: (downloadId: number) => PendingOutputRecord | undefined
  getByOutputId: (outputId: string) => PendingOutputRecord | undefined
  prepare: (
    record: Omit<PendingOutputRecord, "downloadId"> & { state: "prepared" }
  ) => Promise<PendingOutputRecord>
  attachDownload: (
    outputId: string,
    downloadId: number
  ) => Promise<PendingOutputRecord | undefined>
  accept: (record: PendingOutputRecord) => Promise<PendingOutputRecord>
  markTerminal: (
    downloadId: number,
    state: "complete" | "interrupted",
    error?: string
  ) => Promise<PendingOutputRecord | undefined>
  markPreparedInterrupted: (
    outputId: string,
    error: string
  ) => Promise<PendingOutputRecord | undefined>
  markBlobRevoked: (outputId: string) => Promise<void>
  releaseJob: (jobId: string) => Promise<void>
  waitForJobOutputs: (input: {
    jobId: string
    requested: number
    failedBeforeHandoff?: number
  }) => Promise<PendingOutputSummary>
  snapshot: () => Map<string, PendingOutputRecord>
  hasBlobDependencies: () => boolean
}

function isPendingOutputRecord(value: unknown): value is PendingOutputRecord {
  if (!value || typeof value !== "object") return false
  const record = value as Partial<PendingOutputRecord>
  return (
    typeof record.outputId === "string" &&
    typeof record.jobId === "string" &&
    typeof record.taskId === "string" &&
    typeof record.chapterId === "string" &&
    typeof record.blobUrl === "string" &&
    typeof record.filename === "string" &&
    typeof record.attempt === "number" &&
    typeof record.outputIndex === "number" &&
    typeof record.outputCount === "number" &&
    (record.outputKind === "archive" || record.outputKind === "image") &&
    (record.state === "prepared" ||
      record.state === "in_progress" ||
      record.state === "complete" ||
      record.state === "interrupted") &&
    typeof record.createdAt === "number" &&
    (record.state === "prepared" ||
      record.state === "interrupted" ||
      typeof record.downloadId === "number")
  )
}

function toSerializableRecord(
  recordsByOutputId: Map<string, PendingOutputRecord>
): Record<string, PendingOutputRecord> {
  return Object.fromEntries(recordsByOutputId.entries())
}

export function createPendingDownloadsStore(): PendingDownloadsStore {
  const recordsByDownloadId = new Map<number, PendingOutputRecord>()
  const recordsByOutputId = new Map<string, PendingOutputRecord>()
  const waitersByJobId = new Map<string, Set<() => void>>()
  let mutationChain: Promise<unknown> = Promise.resolve()

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = mutationChain.catch(() => undefined).then(operation)
    mutationChain = next
    return next
  }

  const persistRecords = async (
    records: Map<string, PendingOutputRecord>
  ): Promise<void> => {
    await chrome.storage.local.set({
      [LOCAL_STORAGE_KEYS.pendingOutputs]: toSerializableRecord(records),
    })
  }

  const persist = async (): Promise<void> => {
    await persistRecords(recordsByOutputId)
  }

  const commitRecords = (records: Map<string, PendingOutputRecord>): void => {
    recordsByOutputId.clear()
    recordsByDownloadId.clear()
    for (const [outputId, record] of records) {
      recordsByOutputId.set(outputId, record)
      if (record.downloadId !== undefined) {
        recordsByDownloadId.set(record.downloadId, record)
      }
    }
  }

  const persistThenCommit = async (
    records: Map<string, PendingOutputRecord>
  ): Promise<void> => {
    await persistRecords(records)
    commitRecords(records)
  }

  const notifyJobWaiters = (jobId: string): void => {
    const waiters = waitersByJobId.get(jobId)
    if (!waiters) return
    waitersByJobId.delete(jobId)
    for (const notify of waiters) notify()
  }

  const summarize = (input: {
    jobId: string
    requested: number
    failedBeforeHandoff: number
  }): PendingOutputSummary | null => {
    const records = [...recordsByOutputId.values()].filter(
      (record) => record.jobId === input.jobId
    )
    const committedRecords = records.filter(
      (record) => record.state === "complete"
    )
    const nativeInterrupted = records.filter(
      (record) =>
        record.state === "interrupted" && record.downloadId !== undefined
    ).length
    const failed = Math.min(
      input.requested,
      Math.max(0, input.failedBeforeHandoff) + nativeInterrupted
    )
    const committed = Math.min(
      input.requested - failed,
      committedRecords.length
    )
    if (committed + failed < input.requested) return null
    return {
      requested: input.requested,
      committed,
      failed,
      completedDownloadIds: committedRecords
        .map((record) => record.downloadId)
        .filter((downloadId): downloadId is number => downloadId !== undefined),
    }
  }

  return {
    async hydrate() {
      await enqueue(async () => {
        const result = await chrome.storage.local.get(
          LOCAL_STORAGE_KEYS.pendingOutputs
        )
        const raw = result[LOCAL_STORAGE_KEYS.pendingOutputs]
        recordsByDownloadId.clear()
        recordsByOutputId.clear()

        if (raw && typeof raw === "object") {
          for (const candidate of Object.values(
            raw as Record<string, unknown>
          )) {
            if (!isPendingOutputRecord(candidate)) continue
            if (candidate.downloadId !== undefined) {
              recordsByDownloadId.set(candidate.downloadId, candidate)
            }
            recordsByOutputId.set(candidate.outputId, candidate)
          }
        }

        // One-time compatibility migration for versions that kept only
        // downloadId -> Blob URL in storage.session. The synthetic identity is
        // cleanup-only; it is never treated as task output success.
        if (recordsByOutputId.size === 0) {
          const legacy = await chrome.storage.session.get(
            SESSION_STORAGE_KEYS.pendingDownloads
          )
          const legacyValue = legacy[SESSION_STORAGE_KEYS.pendingDownloads]
          if (legacyValue && typeof legacyValue === "object") {
            for (const [rawId, blobUrl] of Object.entries(
              legacyValue as Record<string, unknown>
            )) {
              const downloadId = Number(rawId)
              if (!Number.isFinite(downloadId) || typeof blobUrl !== "string") {
                continue
              }
              const outputId = `legacy:${downloadId}`
              const record: PendingOutputRecord = {
                outputId,
                jobId: "legacy",
                attempt: 0,
                taskId: "legacy",
                chapterId: "legacy",
                downloadId,
                blobUrl,
                filename: "",
                outputIndex: 0,
                outputCount: 1,
                outputKind: "archive",
                state: "in_progress",
                createdAt: Date.now(),
              }
              recordsByDownloadId.set(downloadId, record)
              recordsByOutputId.set(outputId, record)
            }
            await persist()
            await chrome.storage.session.remove(
              SESSION_STORAGE_KEYS.pendingDownloads
            )
          }
        }
      })
    },
    get(downloadId) {
      return recordsByDownloadId.get(downloadId)
    },
    getByOutputId(outputId) {
      return recordsByOutputId.get(outputId)
    },
    async prepare(record) {
      return enqueue(async () => {
        const existing = recordsByOutputId.get(record.outputId)
        if (existing) return existing
        const nextRecords = new Map(recordsByOutputId)
        nextRecords.set(record.outputId, record)
        await persistThenCommit(nextRecords)
        notifyJobWaiters(record.jobId)
        return record
      })
    },
    async attachDownload(outputId, downloadId) {
      return enqueue(async () => {
        const current = recordsByOutputId.get(outputId)
        if (!current) return undefined
        if (current.downloadId !== undefined) {
          notifyJobWaiters(current.jobId)
          return current
        }
        const next: PendingOutputRecord = {
          ...current,
          downloadId,
          state: "in_progress",
        }
        const nextRecords = new Map(recordsByOutputId)
        nextRecords.set(outputId, next)
        await persistThenCommit(nextRecords)
        notifyJobWaiters(next.jobId)
        return next
      })
    },
    async accept(record) {
      return enqueue(async () => {
        const existing = recordsByOutputId.get(record.outputId)
        if (existing) return existing
        const nextRecords = new Map(recordsByOutputId)
        nextRecords.set(record.outputId, record)
        await persistThenCommit(nextRecords)
        notifyJobWaiters(record.jobId)
        return record
      })
    },
    async markTerminal(downloadId, state, error) {
      return enqueue(async () => {
        const current = recordsByDownloadId.get(downloadId)
        if (!current) return undefined
        if (current.state !== "in_progress") {
          notifyJobWaiters(current.jobId)
          return current
        }
        const next: PendingOutputRecord = {
          ...current,
          state,
          terminalAt: Date.now(),
          error,
        }
        const nextRecords = new Map(recordsByOutputId)
        nextRecords.set(next.outputId, next)
        await persistThenCommit(nextRecords)
        notifyJobWaiters(next.jobId)
        return next
      })
    },
    async markPreparedInterrupted(outputId, error) {
      return enqueue(async () => {
        const current = recordsByOutputId.get(outputId)
        if (!current) return undefined
        if (current.state !== "prepared") {
          notifyJobWaiters(current.jobId)
          return current
        }
        const next: PendingOutputRecord = {
          ...current,
          state: "interrupted",
          terminalAt: Date.now(),
          error,
        }
        const nextRecords = new Map(recordsByOutputId)
        nextRecords.set(outputId, next)
        await persistThenCommit(nextRecords)
        notifyJobWaiters(next.jobId)
        return next
      })
    },
    async markBlobRevoked(outputId) {
      await enqueue(async () => {
        const current = recordsByOutputId.get(outputId)
        if (!current || current.blobRevokedAt) return
        const next = { ...current, blobRevokedAt: Date.now() }
        const nextRecords = new Map(recordsByOutputId)
        if (
          next.accountedAt &&
          (next.state === "complete" || next.state === "interrupted")
        ) {
          nextRecords.delete(next.outputId)
        } else {
          nextRecords.set(next.outputId, next)
        }
        await persistThenCommit(nextRecords)
      })
    },
    async releaseJob(jobId) {
      await enqueue(async () => {
        let changed = false
        const nextRecords = new Map(recordsByOutputId)
        const accountedAt = Date.now()
        for (const record of [...nextRecords.values()]) {
          if (record.jobId !== jobId) continue
          if (record.state !== "complete" && record.state !== "interrupted") {
            continue
          }
          if (record.blobRevokedAt) {
            nextRecords.delete(record.outputId)
          } else if (!record.accountedAt) {
            nextRecords.set(record.outputId, { ...record, accountedAt })
          } else {
            continue
          }
          changed = true
        }
        if (changed) await persistThenCommit(nextRecords)
      })
    },
    async waitForJobOutputs(input) {
      const requested = Math.max(0, Math.floor(input.requested))
      const failedBeforeHandoff = Math.max(
        0,
        Math.floor(input.failedBeforeHandoff ?? 0)
      )
      for (;;) {
        await mutationChain.catch(() => undefined)
        const summary = summarize({
          jobId: input.jobId,
          requested,
          failedBeforeHandoff,
        })
        if (summary) return summary
        await new Promise<void>((resolve) => {
          const waiters = waitersByJobId.get(input.jobId) ?? new Set()
          waiters.add(resolve)
          waitersByJobId.set(input.jobId, waiters)
        })
      }
    },
    snapshot() {
      return new Map(recordsByOutputId)
    },
    hasBlobDependencies() {
      return [...recordsByOutputId.values()].some(
        (record) =>
          record.state === "prepared" ||
          record.state === "in_progress" ||
          record.blobRevokedAt === undefined
      )
    },
  }
}
