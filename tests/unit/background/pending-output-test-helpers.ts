import { vi } from "vitest"

import type { PendingDownloadsStore } from "@/entrypoints/background/pending-downloads"
import type { PendingOutputRecord } from "@/src/types/queue-state"

export function createPendingOutputRecord(
  overrides: Partial<PendingOutputRecord> = {}
): PendingOutputRecord {
  return {
    outputId: "job-1:archive:0",
    jobId: "job-1",
    attempt: 1,
    taskId: "task-1",
    chapterId: "chapter-1",
    downloadId: 42,
    blobUrl: "blob:output-1",
    filename: "Series/Chapter 1.cbz",
    outputIndex: 0,
    outputCount: 1,
    outputKind: "archive",
    state: "in_progress",
    createdAt: 1_000,
    ...overrides,
  }
}

export function createPendingDownloadsStoreStub(
  seed: readonly PendingOutputRecord[] = []
) {
  const byOutputId = new Map<string, PendingOutputRecord>()
  const byDownloadId = new Map<number, PendingOutputRecord>()

  const put = (record: PendingOutputRecord): PendingOutputRecord => {
    byOutputId.set(record.outputId, record)
    if (record.downloadId !== undefined) {
      byDownloadId.set(record.downloadId, record)
    }
    return record
  }
  for (const record of seed) put(record)

  const store = {
    hydrate: vi.fn(async () => undefined),
    get: vi.fn((downloadId: number) => byDownloadId.get(downloadId)),
    getByOutputId: vi.fn((outputId: string) => byOutputId.get(outputId)),
    prepare: vi.fn(
      async (
        record: Omit<PendingOutputRecord, "downloadId"> & {
          state: "prepared"
        }
      ) => byOutputId.get(record.outputId) ?? put(record)
    ),
    attachDownload: vi.fn(async (outputId: string, downloadId: number) => {
      const current = byOutputId.get(outputId)
      if (!current) return undefined
      if (current.downloadId !== undefined) return current
      return put({ ...current, downloadId, state: "in_progress" })
    }),
    accept: vi.fn(
      async (record: PendingOutputRecord) =>
        byOutputId.get(record.outputId) ?? put(record)
    ),
    markTerminal: vi.fn(
      async (
        downloadId: number,
        state: "complete" | "interrupted",
        error?: string
      ) => {
        const current = byDownloadId.get(downloadId)
        if (!current) return undefined
        if (current.state !== "in_progress") return current
        return put({ ...current, state, error, terminalAt: Date.now() })
      }
    ),
    markPreparedInterrupted: vi.fn(async (outputId: string, error: string) => {
      const current = byOutputId.get(outputId)
      if (!current) return undefined
      if (current.state !== "prepared") return current
      return put({
        ...current,
        state: "interrupted",
        error,
        terminalAt: Date.now(),
      })
    }),
    markBlobRevoked: vi.fn(async (outputId: string) => {
      const current = byOutputId.get(outputId)
      if (current) put({ ...current, blobRevokedAt: Date.now() })
    }),
    releaseJob: vi.fn(async (jobId: string) => {
      for (const record of [...byOutputId.values()]) {
        if (
          record.jobId === jobId &&
          record.state !== "prepared" &&
          record.state !== "in_progress" &&
          record.blobRevokedAt !== undefined
        ) {
          byOutputId.delete(record.outputId)
          if (record.downloadId !== undefined) {
            byDownloadId.delete(record.downloadId)
          }
        }
      }
    }),
    waitForJobOutputs: vi.fn(
      async (input: {
        jobId: string
        requested: number
        failedBeforeHandoff?: number
      }) => {
        const records = [...byOutputId.values()].filter(
          (record) => record.jobId === input.jobId
        )
        const committedRecords = records.filter(
          (record) => record.state === "complete"
        )
        const interrupted = records.filter(
          (record) => record.state === "interrupted"
        ).length
        const failed = Math.min(
          input.requested,
          Math.max(0, input.failedBeforeHandoff ?? 0) + interrupted
        )
        return {
          requested: input.requested,
          committed: committedRecords.length,
          failed: Math.max(failed, input.requested - committedRecords.length),
          completedDownloadIds: committedRecords
            .map((record) => record.downloadId)
            .filter(
              (downloadId): downloadId is number => downloadId !== undefined
            ),
        }
      }
    ),
    snapshot: vi.fn(() => new Map(byOutputId)),
    hasBlobDependencies: vi.fn(() =>
      [...byOutputId.values()].some(
        (record) =>
          record.state === "prepared" ||
          record.state === "in_progress" ||
          record.blobRevokedAt === undefined
      )
    ),
  } satisfies PendingDownloadsStore

  return store
}
