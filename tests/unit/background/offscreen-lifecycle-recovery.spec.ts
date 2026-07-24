import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { recoverFromLivenessTimeout } from "@/entrypoints/background/offscreen-lifecycle"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import type {
  ActiveDispatchLease,
  OffscreenJobStage,
} from "@/src/types/queue-state"
import { createPendingDownloadsStoreStub } from "./pending-output-test-helpers"

const ACTIVE_JOB_STAGES: readonly OffscreenJobStage[] = [
  "dispatching",
  "accepted",
  "resolving",
  "downloading",
  "transforming",
  "archiving",
  "saving",
]

const mocks = vi.hoisted(() => ({
  getLease: vi.fn(),
  renewLease: vi.fn(),
  clearLease: vi.fn(),
  notifyTerminalTask: vi.fn(async () => undefined),
}))

vi.mock("@/src/runtime/active-dispatch-lease", () => ({
  activeDispatchLeaseStore: {
    get: mocks.getLease,
    renew: mocks.renewLease,
    clear: mocks.clearLease,
  },
}))

vi.mock("@/entrypoints/background/download-queue-finalization", () => ({
  notifyTerminalDownloadTask: mocks.notifyTerminalTask,
}))

function createLease(overrides: Partial<ActiveDispatchLease> = {}) {
  return {
    jobId: "job-1",
    attempt: 1,
    taskId: "task-1",
    chapterId: "chapter-1",
    stage: "downloading" as const,
    sequence: 4,
    startedAt: 1_000,
    lastActivityAt: 2_000,
    leaseExpiresAt: Date.now() - 1,
    ...overrides,
  } satisfies ActiveDispatchLease
}

function createStateManager(active = true) {
  const task = {
    id: "task-1",
    status: active ? ("downloading" as const) : ("failed" as const),
    chapters: [
      {
        id: "chapter-1",
        url: "https://example.com/chapter-1",
        title: "Chapter 1",
        index: 1,
        status: "downloading" as const,
        outputs: { requested: 1, committed: 0, failed: 0 },
        lastUpdated: 1,
      },
      {
        id: "chapter-2",
        url: "https://example.com/chapter-2",
        title: "Chapter 2",
        index: 2,
        status: "queued" as const,
        lastUpdated: 1,
      },
    ],
  }
  const transitionDownloadTask = vi.fn(async () => ({
    success: true as const,
    task: { ...task, status: "failed" as const },
  }))
  return {
    manager: {
      getGlobalState: vi.fn(async () => ({ downloadQueue: [task] })),
      transitionDownloadTask,
    } as unknown as CentralizedStateManager,
    transitionDownloadTask,
  }
}

describe("recoverFromLivenessTimeout", () => {
  const closeDocument = vi.fn(async () => undefined)
  const hasDocument = vi.fn(async () => true)
  const sendMessage = vi.fn<
    (message: {
      type: string
      payload?: { requestId?: string }
    }) => Promise<unknown>
  >(async (message) => {
    if (message.type === "OFFSCREEN_QUERY_JOB") {
      return {
        success: true,
        requestId: message.payload?.requestId,
        job: null,
      }
    }
    return { success: true, canceled: true }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getLease.mockResolvedValue(null)
    mocks.renewLease.mockResolvedValue(true)
    mocks.clearLease.mockResolvedValue(true)
    hasDocument.mockResolvedValue(true)
    vi.stubGlobal("chrome", {
      storage: { session: { set: vi.fn(async () => undefined) } },
      offscreen: { hasDocument, closeDocument },
      runtime: { sendMessage },
    } as unknown as typeof chrome)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("does nothing when there is no active task", async () => {
    const { manager } = createStateManager(false)

    await recoverFromLivenessTimeout(
      manager,
      createPendingDownloadsStoreStub(),
      vi.fn()
    )

    expect(mocks.getLease).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it("does not query or recover an unexpired dispatch lease", async () => {
    const { manager, transitionDownloadTask } = createStateManager()
    mocks.getLease.mockResolvedValue(
      createLease({ leaseExpiresAt: Date.now() + 30_000 })
    )

    await recoverFromLivenessTimeout(
      manager,
      createPendingDownloadsStoreStub(),
      vi.fn()
    )

    expect(sendMessage).not.toHaveBeenCalled()
    expect(transitionDownloadTask).not.toHaveBeenCalled()
  })

  it.each(ACTIVE_JOB_STAGES)(
    "renews a matching active job after a worker interruption during %s",
    async (stage) => {
      const lease = createLease({ stage })
      const { manager, transitionDownloadTask } = createStateManager()
      mocks.getLease.mockResolvedValue(lease)
      sendMessage.mockImplementationOnce(async (message) => ({
        success: true,
        requestId: message.payload?.requestId,
        job: {
          jobId: lease.jobId,
          attempt: lease.attempt,
          taskId: lease.taskId,
          chapterId: lease.chapterId,
          status: "active",
          stage,
          sequence: 8,
        },
      }))
      const onRecover = vi.fn(async () => undefined)

      await recoverFromLivenessTimeout(
        manager,
        createPendingDownloadsStoreStub(),
        onRecover
      )

      expect(mocks.renewLease).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: "job-1", sequence: 8 })
      )
      expect(transitionDownloadTask).not.toHaveBeenCalled()
      expect(onRecover).not.toHaveBeenCalled()
      expect(closeDocument).not.toHaveBeenCalled()
    }
  )

  it("does not let an unchanged active-job sequence renew an expired lease forever", async () => {
    const lease = createLease()
    const { manager, transitionDownloadTask } = createStateManager()
    mocks.getLease.mockResolvedValue(lease)
    mocks.renewLease.mockResolvedValue(false)
    sendMessage.mockImplementationOnce(async (message) => ({
      success: true,
      requestId: message.payload?.requestId,
      job: {
        jobId: lease.jobId,
        attempt: lease.attempt,
        taskId: lease.taskId,
        chapterId: lease.chapterId,
        status: "active",
        stage: lease.stage,
        sequence: lease.sequence,
      },
    }))

    await recoverFromLivenessTimeout(
      manager,
      createPendingDownloadsStoreStub(),
      vi.fn(async () => undefined)
    )

    expect(mocks.renewLease).toHaveBeenCalledWith(
      expect.objectContaining({ requireSequenceAdvance: true })
    )
    expect(transitionDownloadTask).toHaveBeenCalledWith(
      "task-1",
      ["downloading"],
      expect.objectContaining({ status: "failed" })
    )
  })

  it("re-enters the runner for a matching terminal job without closing offscreen", async () => {
    const lease = createLease()
    const { manager } = createStateManager()
    mocks.getLease.mockResolvedValue(lease)
    sendMessage.mockImplementationOnce(async (message) => ({
      success: true,
      requestId: message.payload?.requestId,
      job: {
        jobId: lease.jobId,
        attempt: lease.attempt,
        taskId: lease.taskId,
        chapterId: lease.chapterId,
        status: "terminal",
        stage: "saving",
        sequence: 9,
        outcome: { status: "completed", outputsRequested: 1 },
      },
    }))
    const onRecover = vi.fn(async () => undefined)

    await recoverFromLivenessTimeout(
      manager,
      createPendingDownloadsStoreStub(),
      onRecover
    )

    expect(onRecover).toHaveBeenCalledWith("task-1")
    expect(closeDocument).not.toHaveBeenCalled()
  })

  it("defers destructive recovery while a Blob-backed output is pending", async () => {
    const { manager, transitionDownloadTask } = createStateManager()
    mocks.getLease.mockResolvedValue(createLease())
    const store = createPendingDownloadsStoreStub()
    store.hasBlobDependencies.mockReturnValue(true)

    await recoverFromLivenessTimeout(manager, store, vi.fn())

    expect(transitionDownloadTask).not.toHaveBeenCalled()
    expect(mocks.clearLease).not.toHaveBeenCalled()
    expect(closeDocument).not.toHaveBeenCalled()
  })

  it("fails unreconciled work, clears its lease, and closes an idle document", async () => {
    const { manager, transitionDownloadTask } = createStateManager()
    mocks.getLease.mockResolvedValue(createLease())
    const onRecover = vi.fn(async () => undefined)

    await recoverFromLivenessTimeout(
      manager,
      createPendingDownloadsStoreStub(),
      onRecover
    )

    expect(transitionDownloadTask).toHaveBeenCalledWith(
      "task-1",
      ["downloading"],
      expect.objectContaining({
        status: "failed",
        chapters: [
          expect.objectContaining({
            id: "chapter-1",
            status: "failed",
          }),
          expect.objectContaining({
            id: "chapter-2",
            status: "failed",
          }),
        ],
      })
    )
    expect(mocks.clearLease).toHaveBeenCalledTimes(1)
    expect(closeDocument).toHaveBeenCalledTimes(1)
    expect(onRecover).toHaveBeenCalledTimes(1)
  })
})
