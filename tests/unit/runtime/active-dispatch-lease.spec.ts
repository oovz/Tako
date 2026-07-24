import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  createActiveDispatchLeaseStore,
  createDispatchLease,
} from "@/src/runtime/active-dispatch-lease"
import { OFFSCREEN_JOB_LEASE_MS } from "@/src/constants/timeouts"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"

describe("active dispatch lease store", () => {
  let local: Record<string, unknown>

  beforeEach(() => {
    local = {}
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: local[key] })),
          set: vi.fn(async (values: Record<string, unknown>) => {
            Object.assign(local, structuredClone(values))
          }),
          remove: vi.fn(async (key: string) => {
            delete local[key]
          }),
        },
      },
    } as unknown as typeof chrome)
  })

  it("creates a dispatching lease with a bounded expiry", () => {
    expect(
      createDispatchLease({
        jobId: "job-1",
        taskId: "task-1",
        chapterId: "chapter-1",
        attempt: 2,
        now: 1_000,
      })
    ).toEqual({
      jobId: "job-1",
      taskId: "task-1",
      chapterId: "chapter-1",
      attempt: 2,
      stage: "dispatching",
      startedAt: 1_000,
      lastActivityAt: 1_000,
      leaseExpiresAt: 1_000 + OFFSCREEN_JOB_LEASE_MS,
      sequence: 0,
    })
  })

  it("persists and reads a valid lease while rejecting corrupt records", async () => {
    const store = createActiveDispatchLeaseStore()
    const lease = createDispatchLease({
      jobId: "job-1",
      taskId: "task-1",
      chapterId: "chapter-1",
      attempt: 1,
      now: 1_000,
    })

    await store.set(lease)
    await expect(store.get()).resolves.toEqual(lease)

    local[LOCAL_STORAGE_KEYS.activeDispatchLease] = {
      ...lease,
      jobId: "",
      leaseExpiresAt: Number.NaN,
    }
    await expect(store.get()).resolves.toBeNull()
  })

  it("renews only the matching identity with a newer sequence", async () => {
    const store = createActiveDispatchLeaseStore()
    await store.set(
      createDispatchLease({
        jobId: "job-1",
        taskId: "task-1",
        chapterId: "chapter-1",
        attempt: 1,
        now: 1_000,
      })
    )

    await expect(
      store.renew({
        jobId: "job-1",
        attempt: 1,
        stage: "downloading",
        sequence: 2,
        activityAt: 2_000,
      })
    ).resolves.toBe(true)
    await expect(store.get()).resolves.toMatchObject({
      stage: "downloading",
      sequence: 2,
      lastActivityAt: 2_000,
      leaseExpiresAt: 2_000 + OFFSCREEN_JOB_LEASE_MS,
    })

    await expect(
      store.renew({
        jobId: "other-job",
        attempt: 1,
        stage: "saving",
        sequence: 3,
        activityAt: 3_000,
      })
    ).resolves.toBe(false)
    await expect(
      store.renew({
        jobId: "job-1",
        attempt: 1,
        stage: "saving",
        sequence: 1,
        activityAt: 3_000,
      })
    ).resolves.toBe(false)
    await expect(store.get()).resolves.toMatchObject({
      stage: "downloading",
      sequence: 2,
      lastActivityAt: 2_000,
    })
  })

  it("acknowledges an exact duplicate without extending its lease", async () => {
    const store = createActiveDispatchLeaseStore()
    await store.set(
      createDispatchLease({
        jobId: "job-1",
        taskId: "task-1",
        chapterId: "chapter-1",
        attempt: 1,
        now: 1_000,
      })
    )
    await store.renew({
      jobId: "job-1",
      attempt: 1,
      stage: "accepted",
      sequence: 1,
      activityAt: 2_000,
    })
    const beforeDuplicate = await store.get()

    await expect(
      store.renew({
        jobId: "job-1",
        attempt: 1,
        stage: "accepted",
        sequence: 1,
        activityAt: 99_000,
      })
    ).resolves.toBe(true)
    await expect(store.get()).resolves.toEqual(beforeDuplicate)
    await expect(
      store.renew({
        jobId: "job-1",
        attempt: 1,
        stage: "accepted",
        sequence: 1,
        activityAt: 99_000,
        requireSequenceAdvance: true,
      })
    ).resolves.toBe(false)
    await expect(store.get()).resolves.toEqual(beforeDuplicate)
    await expect(
      store.renew({
        jobId: "job-1",
        attempt: 1,
        stage: "saving",
        sequence: 1,
        activityAt: 99_000,
      })
    ).resolves.toBe(false)
  })

  it("clears only the requested job identity", async () => {
    const store = createActiveDispatchLeaseStore()
    await store.set(
      createDispatchLease({
        jobId: "job-1",
        taskId: "task-1",
        chapterId: "chapter-1",
        attempt: 1,
      })
    )

    await expect(store.clear({ jobId: "job-1", attempt: 2 })).resolves.toBe(
      false
    )
    await expect(store.get()).resolves.not.toBeNull()
    await expect(store.clear({ jobId: "job-1", attempt: 1 })).resolves.toBe(
      true
    )
    await expect(store.get()).resolves.toBeNull()
  })

  it("continues processing mutations after a storage rejection", async () => {
    const store = createActiveDispatchLeaseStore()
    const first = createDispatchLease({
      jobId: "job-failed",
      taskId: "task-1",
      chapterId: "chapter-1",
      attempt: 1,
    })
    const second = createDispatchLease({
      jobId: "job-recovered",
      taskId: "task-1",
      chapterId: "chapter-2",
      attempt: 1,
    })
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(
      new Error("temporary storage failure")
    )

    await expect(store.set(first)).rejects.toThrow("temporary storage failure")
    await expect(store.set(second)).resolves.toBeUndefined()
    await expect(store.get()).resolves.toEqual(second)
  })
})
