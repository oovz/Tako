import logger from "@/src/runtime/logger"
import { OFFSCREEN_HEARTBEAT_INTERVAL_MS } from "@/src/constants/timeouts"
import type {
  OffscreenJobIncarnation,
  OffscreenJobOutcome,
  OffscreenJobStage,
  OffscreenJobState,
} from "@/src/runtime/offscreen-job-contracts"
import type {
  RuntimeMessageRequest,
  RuntimeMessageResponse,
} from "@/src/runtime/runtime-message-contracts"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import type { ChapterOutcome } from "./chapter-processing"
import type { UnsequencedProgressPayload } from "./progress-helpers"
import type { JsonObject } from "@/src/types/site-integrations"

export type OffscreenDownloadChapterPayload =
  RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_CHAPTER">["payload"]

export type OffscreenJobRecord = {
  request: OffscreenDownloadChapterPayload
  integrationContext: JsonObject | undefined
  controller: AbortController
  stage: OffscreenJobStage
  sequence: number
  status: "active" | "terminal" | "canceled"
  outcome?: ChapterOutcome
  promise: Promise<ChapterOutcome>
  heartbeatTimer?: ReturnType<typeof setInterval>
  heartbeatInFlight: boolean
  eventTail: Promise<void>
  updatedAt: number
}

export interface OffscreenJobEventCoordinatorCallbacks {
  pruneTerminalJobs: () => void
}

export class OffscreenJobEventCoordinator {
  constructor(
    private readonly documentInstanceId: string,
    private readonly callbacks: OffscreenJobEventCoordinatorCallbacks
  ) {}

  jobIncarnation(record: OffscreenJobRecord): OffscreenJobIncarnation {
    return {
      jobId: record.request.jobId,
      attempt: record.request.attempt,
      taskId: record.request.taskId,
      chapterId: record.request.chapter.id,
      fingerprint: record.request.fingerprint,
      documentInstanceId: this.documentInstanceId,
    }
  }

  toJobState(record: OffscreenJobRecord): OffscreenJobState {
    return {
      ...this.jobIncarnation(record),
      status: record.status,
      stage: record.stage,
      lastSequence: record.sequence,
      outcome: record.outcome,
    }
  }

  nextJobSequence(record: OffscreenJobRecord): number {
    record.sequence += 1
    record.updatedAt = Date.now()
    return record.sequence
  }

  async sendJobAccepted(record: OffscreenJobRecord): Promise<void> {
    await this.runJobEventExclusive(record, async () => {
      record.stage = "accepted"
      const sequence = this.nextJobSequence(record)
      const response = await sendRuntimeMessage({
        target: "background",
        type: "OFFSCREEN_JOB_ACCEPTED",
        payload: {
          ...this.jobIncarnation(record),
          acceptedAt: Date.now(),
          sequence,
        },
      })
      this.requireCurrentRenewal(record, response)
    })
  }

  startJobHeartbeat(record: OffscreenJobRecord): void {
    this.stopJobHeartbeat(record)
    record.heartbeatTimer = setInterval(() => {
      if (record.status !== "active" || record.heartbeatInFlight) return
      record.heartbeatInFlight = true
      void this.sendJobHeartbeat(record)
        .catch((error) => {
          logger.debug("Job heartbeat delivery failed", error)
          this.loseJobAuthority(record, error)
        })
        .finally(() => {
          record.heartbeatInFlight = false
        })
    }, OFFSCREEN_HEARTBEAT_INTERVAL_MS)
  }

  stopJobHeartbeat(record: OffscreenJobRecord): void {
    if (record.heartbeatTimer !== undefined) {
      clearInterval(record.heartbeatTimer)
      record.heartbeatTimer = undefined
    }
  }

  async sendJobHeartbeat(record: OffscreenJobRecord): Promise<void> {
    await this.runJobEventExclusive(record, async () => {
      if (record.status !== "active") return
      const sequence = this.nextJobSequence(record)
      const response = await sendRuntimeMessage({
        target: "background",
        type: "OFFSCREEN_JOB_HEARTBEAT",
        payload: {
          ...this.jobIncarnation(record),
          stage: record.stage,
          sequence,
          sentAt: Date.now(),
        },
      })
      this.requireCurrentRenewal(record, response)
    })
  }

  async waitForNotBefore(record: OffscreenJobRecord): Promise<void> {
    if (record.controller.signal.aborted) {
      throw new Error("job-cancelled")
    }
    const notBefore = record.request.notBefore ?? 0
    const delayMs = Math.max(0, notBefore - Date.now())
    if (delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer)
          reject(new Error("job-cancelled"))
        }
        const timer = setTimeout(() => {
          record.controller.signal.removeEventListener("abort", onAbort)
          resolve()
        }, delayMs)
        record.controller.signal.addEventListener("abort", onAbort, {
          once: true,
        })
        if (record.controller.signal.aborted) onAbort()
      })
    }
    if (record.controller.signal.aborted) {
      throw new Error("job-cancelled")
    }
    record.stage = "resolving"
    record.updatedAt = Date.now()
  }

  async sendJobProgressMessage(
    record: OffscreenJobRecord,
    payload: UnsequencedProgressPayload
  ): Promise<void> {
    await this.runJobEventExclusive(record, async () => {
      if (record.status !== "active") return
      record.stage = payload.stage
      const sequence = this.nextJobSequence(record)
      const response = await sendRuntimeMessage({
        target: "background",
        type: "OFFSCREEN_DOWNLOAD_PROGRESS",
        payload: {
          ...payload,
          ...this.jobIncarnation(record),
          sequence,
        },
      })
      this.requireCurrentRenewal(record, response)
    })
  }

  async sendJobTerminal(
    record: OffscreenJobRecord,
    outcome: OffscreenJobOutcome
  ): Promise<void> {
    await this.runJobEventExclusive(record, async () => {
      const sequence = this.nextJobSequence(record)
      try {
        const response = await sendRuntimeMessage({
          target: "background",
          type: "OFFSCREEN_JOB_TERMINAL",
          payload: {
            ...this.jobIncarnation(record),
            sequence,
            stage: "saving",
            terminalAt: Date.now(),
            outcome,
          },
        })
        if (
          response.success &&
          response.disposition !== "renewed" &&
          response.disposition !== "stale_or_reordered"
        ) {
          logger.warn("Terminal job event lost current lease authority", {
            jobId: record.request.jobId,
            disposition: response.disposition,
          })
        }
        if (!response.success) {
          logger.warn("Terminal job event was not accepted", response.error)
        }
      } catch (error) {
        logger.warn("Terminal job event delivery failed", error)
      }
    })
  }

  async runJobEventExclusive<T>(
    record: OffscreenJobRecord,
    operation: () => Promise<T>
  ): Promise<T> {
    const result = record.eventTail.catch(() => undefined).then(operation)
    record.eventTail = result.then(
      () => undefined,
      () => undefined
    )
    return await result
  }

  requireCurrentRenewal(
    record: OffscreenJobRecord,
    response: RuntimeMessageResponse<
      | "OFFSCREEN_JOB_ACCEPTED"
      | "OFFSCREEN_JOB_HEARTBEAT"
      | "OFFSCREEN_DOWNLOAD_PROGRESS"
    >
  ): void {
    if (!response.success) {
      const error = new Error(response.error)
      this.loseJobAuthority(record, error)
      throw error
    }
    if (
      response.disposition === "renewed" ||
      response.disposition === "stale_or_reordered"
    ) {
      return
    }
    const error = new Error(
      `Offscreen job authority lost: ${response.disposition}`
    )
    this.loseJobAuthority(record, error)
    throw error
  }

  loseJobAuthority(record: OffscreenJobRecord, reason: unknown): void {
    if (record.status !== "active") return
    record.status = "canceled"
    record.updatedAt = Date.now()
    this.stopJobHeartbeat(record)
    record.controller.abort(reason)
    this.callbacks.pruneTerminalJobs()
  }
}
