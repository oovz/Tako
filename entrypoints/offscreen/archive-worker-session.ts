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

function validateInputLease(
  message: ArchiveWorkerMessage,
  inputId: string | undefined,
  inputLease: OffscreenLiveResourceLease
): void {
  if (!inputId) {
    throw new Error("Archive worker input lease requires an input identity")
  }
  if (
    !(message.buffer instanceof ArrayBuffer) ||
    inputLease.bytes !== message.buffer.byteLength
  ) {
    throw new Error("Archive worker input lease size mismatch")
  }
}

/** Owns one archive worker from collection through exactly one finalization. */
export class ArchiveWorkerSession {
  private state: ArchiveWorkerSessionState = "collecting"
  private timeoutId: ReturnType<typeof setTimeout> | undefined
  private resolveResult: ((result: WorkerZipResult) => void) | undefined
  private rejectResult: ((error: unknown) => void) | undefined
  private result: Promise<WorkerZipResult> | undefined
  private readonly failureController = new AbortController()
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
      try {
        this.handleMessage(event.data)
      } catch (error) {
        this.reject(error)
      }
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

  private handleMessage(
    message: WorkerZipResult | WorkerZipProgress | ArchiveWorkerInputConsumed
  ): void {
    if (isInputConsumed(message)) {
      this.releaseInput(message.inputId)
      return
    }
    if (isProgress(message)) {
      if (this.state !== "finalizing") return
      void Promise.resolve(this.onProgress?.(message)).catch((error) =>
        this.reject(error)
      )
      return
    }
    if (!message.success) {
      this.reject(new Error(message.error || "Archive worker failed"))
      return
    }
    if (this.state !== "finalizing") return
    this.complete(message)
  }

  private complete(result: WorkerZipResult): void {
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

  getState(): ArchiveWorkerSessionState {
    return this.state
  }

  get failureSignal(): AbortSignal {
    return this.failureController.signal
  }

  post(
    message: ArchiveWorkerMessage,
    transfer?: Transferable[],
    inputLease?: OffscreenLiveResourceLease
  ): void {
    this.failureSignal.throwIfAborted()
    if (this.state !== "collecting") {
      throw new Error("Archive worker is not collecting")
    }
    this.retainInput(message, inputLease)
    try {
      this.worker.postMessage(message, transfer ?? [])
    } catch (error) {
      this.reject(error)
      throw error
    }
  }

  private retainInput(
    message: ArchiveWorkerMessage,
    inputLease: OffscreenLiveResourceLease | undefined
  ): void {
    const inputId = message.type === "addImage" ? message.inputId : undefined
    if (inputLease) validateInputLease(message, inputId, inputLease)
    if (inputId && this.inputLeases.has(inputId)) {
      throw new Error("Archive worker input identity collision")
    }
    if (inputId && inputLease) {
      this.inputLeases.set(
        inputId,
        inputLease.transfer(`archive worker input ${inputId}`)
      )
    }
  }

  async finalize(): Promise<WorkerZipResult> {
    this.failureSignal.throwIfAborted()
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
      this.reject(new Error("Zip worker timed out"))
    }, this.finalizationTimeoutMs)
    try {
      this.worker.postMessage({ type: "finalize" })
    } catch (error) {
      this.reject(error)
    }
    return this.result
  }

  reject(error: unknown): void {
    this.settle(() => {
      this.releaseOwnedResources()
      this.failureController.abort(error)
      this.rejectResult?.(error)
    })
  }

  dispose(): void {
    if (this.state === "disposed") return
    const wasPending = this.state !== "settled"
    this.state = "disposed"
    this.clearTimeout()
    this.releaseOwnedResources()
    this.worker.onmessage = null
    this.worker.onerror = null
    this.worker.terminate()
    if (wasPending) {
      const error = new Error("Archive worker session disposed")
      this.failureController.abort(error)
      this.rejectResult?.(error)
    }
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
