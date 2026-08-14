import logger from "@/src/runtime/logger"
import { planQueueScheduling } from "@/src/domain/queue/scheduler-policy"
import type { QueueRepository } from "@/src/storage/queue-repository"

import type {
  DownloadTaskExecutor,
  TaskExecutionResult,
} from "./download-task-executor"

export class QueueScheduler {
  private activationInFlight: Promise<void> | null = null
  private continuationScheduled = false

  constructor(
    private readonly queueRepository: QueueRepository,
    private readonly taskExecutor: DownloadTaskExecutor,
    private readonly onQueueDrained: () => Promise<void>
  ) {}

  async activate(): Promise<void> {
    if (this.activationInFlight) return await this.activationInFlight

    const activation = this.runActivation()
    this.activationInFlight = activation
    try {
      await activation
    } finally {
      if (this.activationInFlight === activation) {
        this.activationInFlight = null
      }
    }
  }

  requestContinuation(): void {
    if (this.continuationScheduled) return
    this.continuationScheduled = true
    queueMicrotask(() => {
      this.continuationScheduled = false
      void this.activate().catch((error) => {
        logger.error("[Queue] Deferred continuation failed", error)
      })
    })
  }

  async resumeTask(taskId: string): Promise<void> {
    const result = await this.taskExecutor.execute(taskId, true)
    if (result === "queue-continuation") {
      await this.activate()
    }
  }

  async activateStartup(
    activation:
      | { kind: "resume-task"; taskId: string }
      | { kind: "process-queue" }
      | undefined
  ): Promise<void> {
    if (!activation) return
    if (activation.kind === "resume-task") {
      await this.resumeTask(activation.taskId)
      return
    }
    await this.activate()
  }

  isTaskActive(taskId: string): boolean {
    return this.taskExecutor.isActive(taskId)
  }

  private async runActivation(): Promise<void> {
    while (true) {
      const [queue, activeLease] = await Promise.all([
        this.queueRepository.getQueue(),
        this.queueRepository.getActiveDispatchLease(),
      ])
      const plan = planQueueScheduling({
        queue,
        activeLease,
      })

      if (plan.kind === "drained") {
        await this.onQueueDrained()
        return
      }
      if (plan.kind === "wait") return

      logger.info("[Queue]", {
        event: "PROCESSING",
        taskId: plan.taskId,
      })
      const result: TaskExecutionResult = await this.taskExecutor.execute(
        plan.taskId
      )
      if (result !== "queue-continuation") return
    }
  }
}
