import { beforeEach, describe, expect, it, vi } from "vitest"

import { createPendingDownloadsStore } from "@/entrypoints/background/pending-downloads"
import {
  LOCAL_STORAGE_KEYS,
  SESSION_STORAGE_KEYS,
} from "@/src/runtime/storage-keys"
import type { PendingOutputRecord } from "@/src/types/queue-state"

let localStore: Record<string, unknown> = {}
let sessionStore: Record<string, unknown> = {}

function preparedRecord(
  overrides: Partial<PendingOutputRecord> = {}
): Omit<PendingOutputRecord, "downloadId"> & { state: "prepared" } {
  return {
    outputId: "job-1:archive:0",
    jobId: "job-1",
    attempt: 1,
    taskId: "task-1",
    chapterId: "chapter-1",
    blobUrl: "blob:output-1",
    filename: "Series/Chapter 1.cbz",
    outputIndex: 0,
    outputCount: 1,
    outputKind: "archive",
    state: "prepared",
    createdAt: 1_000,
    ...overrides,
  } as Omit<PendingOutputRecord, "downloadId"> & { state: "prepared" }
}

describe("pending native output store", () => {
  beforeEach(() => {
    localStore = {}
    sessionStore = {}
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: localStore[key] })),
          set: vi.fn(async (values: Record<string, unknown>) => {
            Object.assign(localStore, structuredClone(values))
          }),
          remove: vi.fn(async (key: string) => {
            delete localStore[key]
          }),
        },
        session: {
          get: vi.fn(async (key: string) => ({ [key]: sessionStore[key] })),
          remove: vi.fn(async (key: string) => {
            delete sessionStore[key]
          }),
        },
      },
    } as unknown as typeof chrome)
  })

  it("persists intent before attaching the Chrome download id", async () => {
    const store = createPendingDownloadsStore()

    await store.prepare(preparedRecord())
    expect(localStore[LOCAL_STORAGE_KEYS.pendingOutputs]).toEqual({
      "job-1:archive:0": expect.objectContaining({
        state: "prepared",
      }),
    })
    expect(
      (
        localStore[LOCAL_STORAGE_KEYS.pendingOutputs] as Record<
          string,
          PendingOutputRecord
        >
      )["job-1:archive:0"]
    ).not.toHaveProperty("downloadId")

    await store.attachDownload("job-1:archive:0", 101)
    expect(store.get(101)).toEqual(
      expect.objectContaining({ downloadId: 101, state: "in_progress" })
    )
    expect(store.getByOutputId("job-1:archive:0")).toEqual(
      expect.objectContaining({ downloadId: 101, state: "in_progress" })
    )
  })

  it("keeps the first record for a duplicate output id", async () => {
    const store = createPendingDownloadsStore()
    const first = await store.prepare(preparedRecord())
    const duplicate = await store.prepare(
      preparedRecord({ blobUrl: "blob:unexpected-duplicate" })
    )

    expect(duplicate).toEqual(first)
    expect(store.snapshot()).toHaveProperty("size", 1)
  })

  it("hydrates rich records from durable local storage", async () => {
    localStore[LOCAL_STORAGE_KEYS.pendingOutputs] = {
      "job-1:archive:0": {
        ...preparedRecord(),
        downloadId: 900,
        state: "in_progress",
      },
    }
    const store = createPendingDownloadsStore()

    await store.hydrate()

    expect(store.get(900)).toEqual(
      expect.objectContaining({ outputId: "job-1:archive:0" })
    )
  })

  it("migrates the legacy session Blob map as cleanup-only records", async () => {
    sessionStore[SESSION_STORAGE_KEYS.pendingDownloads] = {
      "77": "blob:legacy",
    }
    const store = createPendingDownloadsStore()

    await store.hydrate()

    expect(store.get(77)).toEqual(
      expect.objectContaining({
        outputId: "legacy:77",
        jobId: "legacy",
        blobUrl: "blob:legacy",
      })
    )
    expect(sessionStore[SESSION_STORAGE_KEYS.pendingDownloads]).toBeUndefined()
  })

  it("keeps the first terminal result and releases only terminal, revoked records", async () => {
    const store = createPendingDownloadsStore()
    await store.prepare(preparedRecord())
    await store.attachDownload("job-1:archive:0", 101)

    await store.markTerminal(101, "interrupted", "network failed")
    await store.markTerminal(101, "complete")
    expect(store.get(101)).toEqual(
      expect.objectContaining({
        state: "interrupted",
        error: "network failed",
      })
    )

    await store.releaseJob("job-1")
    expect(store.get(101)).toBeDefined()
    await store.markBlobRevoked("job-1:archive:0")
    await store.releaseJob("job-1")
    expect(store.get(101)).toBeUndefined()
  })

  it("waits for native terminal states and includes pre-handoff failures", async () => {
    const store = createPendingDownloadsStore()
    await store.prepare(preparedRecord({ outputCount: 2 }))
    await store.attachDownload("job-1:archive:0", 101)
    const summaryPromise = store.waitForJobOutputs({
      jobId: "job-1",
      requested: 2,
      failedBeforeHandoff: 1,
    })

    await store.markTerminal(101, "complete")

    await expect(summaryPromise).resolves.toEqual({
      requested: 2,
      committed: 1,
      failed: 1,
      completedDownloadIds: [101],
    })
  })

  it("describes durable Chrome download identities while a job is waiting", async () => {
    const store = createPendingDownloadsStore()
    await store.prepare(
      preparedRecord({
        outputId: "job-1:archive:1",
        outputIndex: 1,
        outputCount: 2,
        createdAt: 1_500,
      })
    )
    await store.attachDownload("job-1:archive:1", 102)
    await store.prepare(
      preparedRecord({
        outputId: "job-1:archive:0",
        outputIndex: 0,
        outputCount: 2,
        createdAt: 1_000,
      })
    )
    await store.attachDownload("job-1:archive:0", 101)
    await store.markTerminal(102, "complete")

    expect(store.describeJobWait("job-1")).toEqual({
      downloadIds: [101, 102],
      since: 1_000,
      lastObservedAt: expect.any(Number),
    })
    expect(store.describeJobWait("missing-job")).toBeNull()
  })

  it("does not expose an intent whose durable write failed", async () => {
    const store = createPendingDownloadsStore()
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(
      new Error("storage write failed")
    )

    await expect(store.prepare(preparedRecord())).rejects.toThrow(
      "storage write failed"
    )
    expect(store.snapshot()).toHaveProperty("size", 0)

    await expect(store.prepare(preparedRecord())).resolves.toMatchObject({
      state: "prepared",
    })
  })

  it("keeps an accepted download observable when download-id persistence fails", async () => {
    const store = createPendingDownloadsStore()
    await store.prepare(preparedRecord())
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(
      new Error("attachment write failed")
    )

    await expect(
      store.attachDownload("job-1:archive:0", 101)
    ).resolves.toMatchObject({ state: "in_progress", downloadId: 101 })
    expect(store.get(101)).toMatchObject({
      state: "in_progress",
      downloadId: 101,
    })
    expect(store.getByOutputId("job-1:archive:0")).toMatchObject({
      state: "in_progress",
      downloadId: 101,
    })
    await expect(
      store.attachDownload("job-1:archive:0", 102)
    ).resolves.toMatchObject({ state: "in_progress", downloadId: 101 })

    await store.markTerminal(101, "complete")
    expect(store.get(101)).toMatchObject({ state: "complete", downloadId: 101 })
    expect(localStore[LOCAL_STORAGE_KEYS.pendingOutputs]).toEqual({
      "job-1:archive:0": expect.objectContaining({
        state: "complete",
        downloadId: 101,
      }),
    })
  })

  it("does not double-count a pre-handoff failure record", async () => {
    const store = createPendingDownloadsStore()
    await store.prepare(preparedRecord())
    await store.markPreparedInterrupted(
      "job-1:archive:0",
      "Chrome rejected the handoff"
    )

    await expect(
      store.waitForJobOutputs({
        jobId: "job-1",
        requested: 1,
        failedBeforeHandoff: 1,
      })
    ).resolves.toEqual({
      requested: 1,
      committed: 0,
      failed: 1,
      completedDownloadIds: [],
    })
  })

  it("prunes a terminal record regardless of release/revocation order", async () => {
    const store = createPendingDownloadsStore()
    await store.prepare(preparedRecord())
    await store.attachDownload("job-1:archive:0", 101)
    await store.markTerminal(101, "complete")

    await store.releaseJob("job-1")
    expect(store.getByOutputId("job-1:archive:0")).toMatchObject({
      accountedAt: expect.any(Number),
    })
    await store.markBlobRevoked("job-1:archive:0")
    expect(store.getByOutputId("job-1:archive:0")).toBeUndefined()
  })
})
