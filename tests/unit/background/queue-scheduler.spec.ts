import { beforeEach, describe, expect, it, vi } from "vitest"

import { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import type { DownloadTaskExecutor } from "@/entrypoints/background/download-task-executor"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { DownloadTaskState } from "@/src/domain/queue/state"

function task(
  id: string,
  status: DownloadTaskState["status"],
  activeBlock?: DownloadTaskState["activeBlock"]
): DownloadTaskState {
  return { id, status, activeBlock } as unknown as DownloadTaskState
}

describe("QueueScheduler", () => {
  const queueRepository = {
    getQueue: vi.fn(),
    getActiveDispatchLease: vi.fn(async () => null),
  } as unknown as QueueRepository
  const taskExecutor = {
    execute: vi.fn(async () => "active" as const),
    isActive: vi.fn(() => false),
  } as unknown as DownloadTaskExecutor
  const onQueueDrained = vi.fn(async () => undefined)
  let scheduler: QueueScheduler

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queueRepository.getQueue).mockResolvedValue([])
    vi.mocked(queueRepository.getActiveDispatchLease).mockResolvedValue(null)
    vi.mocked(taskExecutor.execute).mockResolvedValue("active")
    scheduler = new QueueScheduler(
      queueRepository,
      taskExecutor,
      onQueueDrained
    )
  })

  it("joins concurrent activations and publishes one drained effect", async () => {
    let release!: () => void
    vi.mocked(queueRepository.getQueue).mockImplementation(
      () =>
        new Promise<DownloadTaskState[]>((resolve) => {
          release = () => resolve([])
        })
    )

    const first = scheduler.activate()
    const second = scheduler.activate()
    await vi.waitFor(() => expect(release).toBeTypeOf("function"))
    release()
    await Promise.all([first, second])

    expect(queueRepository.getQueue).toHaveBeenCalledOnce()
    expect(onQueueDrained).toHaveBeenCalledOnce()
  })

  it("starts the first runnable task and stops while it owns the slot", async () => {
    vi.mocked(queueRepository.getQueue).mockResolvedValue([
      task("blocked", "queued", "destination_action_required"),
      task("next", "queued"),
    ])

    await scheduler.activate()

    expect(taskExecutor.execute).toHaveBeenCalledOnce()
    expect(taskExecutor.execute).toHaveBeenCalledWith("next")
    expect(onQueueDrained).not.toHaveBeenCalled()
  })

  it("reloads authority and starts the next task after a non-slot-consuming result", async () => {
    vi.mocked(queueRepository.getQueue)
      .mockResolvedValueOnce([task("first", "queued"), task("next", "queued")])
      .mockResolvedValueOnce([task("next", "queued")])
    vi.mocked(taskExecutor.execute)
      .mockResolvedValueOnce("queue-continuation")
      .mockResolvedValueOnce("active")

    await scheduler.activate()

    expect(taskExecutor.execute).toHaveBeenNthCalledWith(1, "first")
    expect(taskExecutor.execute).toHaveBeenNthCalledWith(2, "next")
  })

  it("waits while another task is owned by native output", async () => {
    vi.mocked(queueRepository.getQueue).mockResolvedValue([
      task("native", "downloading"),
      task("next", "queued"),
    ])
    await scheduler.activate()

    expect(taskExecutor.execute).not.toHaveBeenCalled()
  })

  it("resumes the exact recovered task and then continues the queue", async () => {
    vi.mocked(taskExecutor.execute).mockResolvedValueOnce("queue-continuation")

    await scheduler.activateStartup({ kind: "resume-task", taskId: "active" })

    expect(taskExecutor.execute).toHaveBeenCalledWith("active", true)
    expect(onQueueDrained).toHaveBeenCalledOnce()
  })
})
