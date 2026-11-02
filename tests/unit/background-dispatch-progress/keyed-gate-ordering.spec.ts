import { afterEach, describe, expect, it, vi } from "vitest"
import { runTaskSideEffectExclusive } from "@/entrypoints/background/download-task-side-effect-gate"
import { handleOffscreenDownloadProgress } from "@/entrypoints/background/offscreen-progress-handler"
import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
import { QueueRepository } from "@/src/storage/queue-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { HistoryRepository } from "@/src/storage/history-repository"

vi.mock("@/src/runtime/logger", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

afterEach(() => vi.restoreAllMocks())

function progress(
  jobId: string,
  sequence = 1
): RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_PROGRESS"> {
  return {
    target: "background",
    type: "OFFSCREEN_DOWNLOAD_PROGRESS",
    payload: {
      jobId,
      sequence,
      taskId: "task",
      chapterId: "chapter",
      attempt: 1,
      fingerprint: "a".repeat(64),
      documentInstanceId: "document",
      stage: "downloading",
      status: "downloading",
      outputsRequested: 0,
      outputsFailedBeforeHandoff: 0,
      outputsCommitted: 0,
    },
  }
}

function progressRepository() {
  const repository = new QueueRepository(
    new QueueProjectionService(),
    new HistoryRepository()
  )
  const renew = vi.spyOn(repository, "renewDispatchLease")
  renew.mockResolvedValue({ outcome: "rejected", reason: "lease-not-current" })
  return { repository, renew }
}

describe("keyed background ownership", () => {
  it("orders task handoffs and retains queued ownership when an earlier handoff finishes", async () => {
    const events: string[] = []
    const firstEntered = Promise.withResolvers<void>()
    const secondEntered = Promise.withResolvers<void>()
    const thirdEntered = Promise.withResolvers<void>()
    const firstRelease = Promise.withResolvers<void>()
    const secondRelease = Promise.withResolvers<void>()
    const thirdRelease = Promise.withResolvers<void>()
    const first = runTaskSideEffectExclusive("handoff-order", async () => {
      events.push("first-start")
      firstEntered.resolve()
      await firstRelease.promise
      events.push("first-end")
      return 1
    })
    const second = runTaskSideEffectExclusive("handoff-order", async () => {
      events.push("second-start")
      secondEntered.resolve()
      await secondRelease.promise
      events.push("second-end")
      return 2
    })
    const third = runTaskSideEffectExclusive("handoff-order", async () => {
      events.push("third-start")
      thirdEntered.resolve()
      await thirdRelease.promise
      events.push("third-end")
      return 3
    })
    let fourth: Promise<number> | undefined
    try {
      await firstEntered.promise
      await runTaskSideEffectExclusive("independent-handoff", async () => 0)
      expect(events).toEqual(["first-start"])

      firstRelease.resolve()
      await secondEntered.promise
      fourth = runTaskSideEffectExclusive("handoff-order", async () => {
        events.push("fourth")
        return 4
      })
      await runTaskSideEffectExclusive("independent-handoff", async () => 0)
      expect(events).toEqual(["first-start", "first-end", "second-start"])

      secondRelease.resolve()
      await thirdEntered.promise
      expect(events.at(-1)).toBe("third-start")
      thirdRelease.resolve()
      await expect(
        Promise.all([first, second, third, fourth])
      ).resolves.toEqual([1, 2, 3, 4])
      expect(events).toEqual([
        "first-start",
        "first-end",
        "second-start",
        "second-end",
        "third-start",
        "third-end",
        "fourth",
      ])
    } finally {
      firstRelease.resolve()
      secondRelease.resolve()
      thirdRelease.resolve()
      await Promise.allSettled([first, second, third, fourth])
    }
  })

  it.each(["throw", "reject"] as const)(
    "preserves a task operation's %s failure and releases its successor",
    async (failureKind) => {
      const failure = new Error("handoff failed")
      const failed = runTaskSideEffectExclusive("failed-handoff", () => {
        if (failureKind === "throw") throw failure
        return Promise.reject(failure)
      })
      const successor = runTaskSideEffectExclusive(
        "failed-handoff",
        async () => "successor"
      )
      await expect(failed).rejects.toBe(failure)
      await expect(successor).resolves.toBe("successor")
      await expect(
        runTaskSideEffectExclusive("failed-handoff", async () => "fresh")
      ).resolves.toBe("fresh")
    }
  )

  it("orders progress renewals by job while allowing other jobs to progress", async () => {
    const { repository, renew } = progressRepository()
    const firstEntered = Promise.withResolvers<void>()
    const secondEntered = Promise.withResolvers<void>()
    const firstRelease = Promise.withResolvers<void>()
    const secondRelease = Promise.withResolvers<void>()
    renew.mockImplementation(async (input) => {
      if (input.jobId === "ordered-progress" && input.sequence === 1) {
        firstEntered.resolve()
        await firstRelease.promise
      }
      if (input.jobId === "ordered-progress" && input.sequence === 2) {
        secondEntered.resolve()
        await secondRelease.promise
      }
      return { outcome: "rejected", reason: "lease-not-current" }
    })
    const first = handleOffscreenDownloadProgress(
      repository,
      progress("ordered-progress", 1)
    )
    const second = handleOffscreenDownloadProgress(
      repository,
      progress("ordered-progress", 2)
    )
    const third = handleOffscreenDownloadProgress(
      repository,
      progress("ordered-progress", 3)
    )
    let fourth: ReturnType<typeof handleOffscreenDownloadProgress> | undefined
    try {
      await firstEntered.promise
      await expect(
        handleOffscreenDownloadProgress(repository, progress("other-progress"))
      ).resolves.toEqual({ success: true, disposition: "lease_not_current" })
      expect(
        renew.mock.calls
          .filter(([input]) => input.jobId === "ordered-progress")
          .map(([input]) => input.sequence)
      ).toEqual([1])

      firstRelease.resolve()
      await secondEntered.promise
      fourth = handleOffscreenDownloadProgress(
        repository,
        progress("ordered-progress", 4)
      )
      await handleOffscreenDownloadProgress(
        repository,
        progress("other-progress", 2)
      )
      expect(
        renew.mock.calls
          .filter(([input]) => input.jobId === "ordered-progress")
          .map(([input]) => input.sequence)
      ).toEqual([1, 2])

      secondRelease.resolve()
      const responses = await Promise.all([first, second, third, fourth])
      expect(responses).toEqual(
        Array.from({ length: 4 }, () => ({
          success: true,
          disposition: "lease_not_current",
        }))
      )
      expect(
        renew.mock.calls
          .filter(([input]) => input.jobId === "ordered-progress")
          .map(([input]) => input.sequence)
      ).toEqual([1, 2, 3, 4])
    } finally {
      firstRelease.resolve()
      secondRelease.resolve()
      await Promise.allSettled([first, second, third, fourth])
    }
  })

  it("releases progress ownership after a renewal fails", async () => {
    const { repository, renew } = progressRepository()
    renew.mockRejectedValueOnce(new Error("renewal unavailable"))
    const failed = handleOffscreenDownloadProgress(
      repository,
      progress("failed-progress", 1)
    )
    const successor = handleOffscreenDownloadProgress(
      repository,
      progress("failed-progress", 2)
    )
    await expect(failed).resolves.toEqual({
      success: false,
      error: "renewal unavailable",
    })
    await expect(successor).resolves.toEqual({
      success: true,
      disposition: "lease_not_current",
    })
    expect(renew.mock.calls.map(([input]) => input.sequence)).toEqual([1, 2])
  })

  it("keeps task handoff and progress ownership separate for equal identifiers", async () => {
    const { repository, renew } = progressRepository()
    const handoffEntered = Promise.withResolvers<void>()
    const handoffRelease = Promise.withResolvers<void>()
    const handoff = runTaskSideEffectExclusive("same-identifier", async () => {
      handoffEntered.resolve()
      await handoffRelease.promise
    })
    try {
      await handoffEntered.promise
      await expect(
        handleOffscreenDownloadProgress(repository, progress("same-identifier"))
      ).resolves.toEqual({ success: true, disposition: "lease_not_current" })
      expect(renew).toHaveBeenCalledOnce()
    } finally {
      handoffRelease.resolve()
      await handoff
    }
  })
})
