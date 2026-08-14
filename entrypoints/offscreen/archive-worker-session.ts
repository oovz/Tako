import { ZIP_WORKER_FINALIZATION_TIMEOUT_MS } from "@/src/constants/timeouts"
import type {
  WorkerZipProgress,
  WorkerZipResult,
} from "@/entrypoints/offscreen/chapter-processing-types"
import type { OffscreenLiveResourceLease } from "@/src/runtime/offscreen-live-resource-ledger"

export type ArchiveWorkerSessionState =
  "collecting" | "finalizing" | "settled" | "disposed"

type ArchiveWorkerMessage =
  | { type: "init"; [key: string]: unknown }
  | { type: "addComicInfo"; [key: string]: unknown }
  | { type: "addImage"; inputId?: string; [key: string]: unknown }

type ArchiveWorkerInputConsumed = {
  type: "input-consumed"
  inputId: string
}

function isProgress(
  value: WorkerZipResult | WorkerZipProgress
): value is WorkerZipProgress {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "progress"
  )
}

function isInputConsumed(value: unknown): value is ArchiveWorkerInputConsumed {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "input-consumed" &&
    "inputId" in value &&
    typeof value.inputId === "string"
  )
}

/** Owns one archive worker from collection through exactly one finalization. */
export class ArchiveWorkerSession {
  private state: ArchiveWorkerSessionState = "collecting"
  private timeoutId: ReturnType<typeof setTimeout> | undefined
  private resolveResult: ((result: WorkerZipResult) => void) | undefined
  private rejectResult: ((error: unknown) => void) | undefined
  private result: Promise<WorkerZipResult> | undefined
  private settledError: unknown
  private readonly inputLeases = new Map<string, OffscreenLiveResourceLease>()

  constructor(
    private readonly worker: Worker,
    private readonly onProgress?: (
      progress: WorkerZipProgress
    ) => void | Promise<void>,
    private readonly finalizationTimeoutMs = ZIP_WORKER_FINALIZATION_TIMEOUT_MS,
    private archiveAllowance?: OffscreenLiveResourceLease
  ) {
    this.worker.onmessage = (
      event: MessageEvent<
        WorkerZipResult | WorkerZipProgress | ArchiveWorkerInputConsumed
      >
    ) => {
      if (isInputConsumed(event.data)) {
        this.releaseInput(event.data.inputId)
        return
      }
      if (isProgress(event.data)) {
        if (this.state !== "finalizing") return
        void Promise.resolve(this.onProgress?.(event.data))
        return
      }
      const result = event.data
      if (!result.success) {
        this.reject(new Error(result.error || "Archive worker failed"))
        return
      }
      if (this.state !== "finalizing") return
      if (result.buffer && this.archiveAllowance) {
        this.archiveAllowance.resize(result.buffer.byteLength)
        result.liveResourceLease = this.archiveAllowance.transfer(
          "main archive result buffer"
        )
        this.archiveAllowance = undefined
      }
      this.releaseInputs()
      this.settle(() => this.resolveResult?.(result))
    }
    this.worker.onerror = (event) => {
      const error =
        event.error instanceof Error
          ? event.error
          : new Error(
              event.message
                ? `Zip worker error: ${event.message}${event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : ""}`
                : "Zip worker error"
            )
      this.reject(error)
    }
  }

  getState(): ArchiveWorkerSessionState {
    return this.state
  }

  post(
    message: ArchiveWorkerMessage,
    transfer?: Transferable[],
    inputLease?: OffscreenLiveResourceLease
  ): void {
    if (this.state !== "collecting") {
      throw new Error("Archive worker is not collecting")
    }
    const inputId = message.type === "addImage" ? message.inputId : undefined
    if (inputLease && !inputId) {
      throw new Error("Archive worker input lease requires an input identity")
    }
    if (
      inputLease &&
      (!(message.buffer instanceof ArrayBuffer) ||
        inputLease.bytes !== message.buffer.byteLength)
    ) {
      throw new Error("Archive worker input lease size mismatch")
    }
    if (inputId && this.inputLeases.has(inputId)) {
      throw new Error("Archive worker input identity collision")
    }
    const retainedInputLease = inputLease?.transfer(
      `archive worker input ${inputId}`
    )
    if (inputId && retainedInputLease) {
      this.inputLeases.set(inputId, retainedInputLease)
    }
    try {
      this.worker.postMessage(message, transfer ?? [])
    } catch (error) {
      if (inputId) this.releaseInput(inputId)
      throw error
    }
  }

  finalize(): Promise<WorkerZipResult> {
    if (this.state === "settled" && this.settledError !== undefined) {
      return Promise.reject(
        this.settledError instanceof Error
          ? this.settledError
          : new Error("Archive worker failed before finalization", {
              cause: this.settledError,
            })
      )
    }
    if (this.state !== "collecting") {
      throw new Error(
        "Archive worker cannot be finalized from its current state"
      )
    }
    this.state = "finalizing"
    this.result = new Promise<WorkerZipResult>((resolve, reject) => {
      this.resolveResult = resolve
      this.rejectResult = reject
    })
    this.timeoutId = setTimeout(() => {
      this.settle(() => {
        this.releaseOwnedResources()
        this.rejectResult?.(new Error("Zip worker timed out"))
      })
    }, this.finalizationTimeoutMs)
    try {
      this.worker.postMessage({ type: "finalize" })
    } catch (error) {
      this.settle(() => {
        this.releaseOwnedResources()
        this.rejectResult?.(error)
      })
    }
    return this.result
  }

  reject(error: unknown): void {
    if (this.state === "collecting") {
      this.releaseOwnedResources()
      this.state = "settled"
      this.settledError = error
      return
    }
    this.settle(() => {
      this.releaseOwnedResources()
      this.rejectResult?.(error)
    })
  }

  dispose(): void {
    if (this.state === "disposed") return
    this.clearTimeout()
    this.releaseOwnedResources()
    this.state = "disposed"
    this.worker.onmessage = null
    this.worker.onerror = null
    this.worker.terminate()
  }

  private settle(complete: () => void): void {
    if (this.state === "settled" || this.state === "disposed") return
    this.clearTimeout()
    this.state = "settled"
    complete()
  }

  private clearTimeout(): void {
    if (this.timeoutId === undefined) return
    clearTimeout(this.timeoutId)
    this.timeoutId = undefined
  }

  private releaseInput(inputId: string): void {
    const lease = this.inputLeases.get(inputId)
    if (!lease) return
    this.inputLeases.delete(inputId)
    lease.release()
  }

  private releaseInputs(): void {
    for (const lease of this.inputLeases.values()) lease.release()
    this.inputLeases.clear()
  }

  private releaseOwnedResources(): void {
    this.releaseInputs()
    this.archiveAllowance?.release()
    this.archiveAllowance = undefined
  }
}
