import { NonRetryableDownloadError } from "@/src/shared/download-contract"

export const OFFSCREEN_LIVE_RESOURCE_CAP_BYTES = 1024 * 1024 * 1024

export class OffscreenLiveResourceLimitError extends NonRetryableDownloadError {
  constructor(message: string) {
    super(message)
    this.name = "OffscreenLiveResourceLimitError"
  }
}

type LedgerEntry = {
  bytes: number
  label: string
}

type PendingAcquisition = {
  owner: string
  bytes: number
  signal: AbortSignal | undefined
  resolve: (lease: OffscreenLiveResourceLease) => void
  reject: (reason: unknown) => void
  onAbort: () => void
}

/** Exact ownership of one live allocation counted by an offscreen ledger. */
export class OffscreenLiveResourceLease {
  private token: symbol | undefined

  constructor(
    private readonly ledger: OffscreenLiveResourceLedger,
    token: symbol
  ) {
    this.token = token
  }

  get bytes(): number {
    return this.token === undefined ? 0 : this.ledger.readBytes(this.token)
  }

  resize(bytes: number): void {
    if (this.token === undefined) {
      throw new Error("Offscreen live resource lease is not active")
    }
    this.ledger.resize(this.token, bytes)
  }

  transfer(label: string): OffscreenLiveResourceLease {
    if (this.token === undefined) {
      throw new Error("Offscreen live resource lease is not active")
    }
    const token = this.token
    this.ledger.relabel(token, label)
    this.token = undefined
    return new OffscreenLiveResourceLease(this.ledger, token)
  }

  release(): void {
    if (this.token === undefined) return
    const token = this.token
    this.token = undefined
    this.ledger.release(token)
  }
}

/** One fixed-cap ledger shared by every job in an offscreen document. */
export class OffscreenLiveResourceLedger {
  private readonly entries = new Map<symbol, LedgerEntry>()
  private readonly pendingAcquisitions: PendingAcquisition[] = []
  private usedBytes = 0

  constructor(
    private readonly capacityBytes = OFFSCREEN_LIVE_RESOURCE_CAP_BYTES
  ) {}

  reserve(bytes: number, label: string): OffscreenLiveResourceLease {
    this.assertBytes(bytes)
    this.assertCapacity(bytes)
    return this.createLease(bytes, label)
  }

  acquire(
    owner: string,
    bytes: number,
    signal?: AbortSignal
  ): Promise<OffscreenLiveResourceLease> {
    this.assertBytes(bytes)
    if (bytes > this.capacityBytes) {
      return Promise.reject(this.createCapacityError(bytes))
    }
    if (signal?.aborted) {
      return Promise.reject(this.readAbortReason(signal))
    }
    if (this.pendingAcquisitions.length === 0 && this.hasCapacity(bytes)) {
      return Promise.resolve(this.createLease(bytes, owner))
    }

    return new Promise<OffscreenLiveResourceLease>((resolve, reject) => {
      const request: PendingAcquisition = {
        owner,
        bytes,
        signal,
        resolve,
        reject,
        onAbort: () => {
          if (!signal) return
          const index = this.pendingAcquisitions.indexOf(request)
          if (index === -1) return
          this.pendingAcquisitions.splice(index, 1)
          signal.removeEventListener("abort", request.onAbort)
          reject(this.readAbortReason(signal))
          this.drainPendingAcquisitions()
        },
      }
      this.pendingAcquisitions.push(request)
      signal?.addEventListener("abort", request.onAbort, { once: true })
      if (signal?.aborted) request.onAbort()
    })
  }

  private createLease(
    bytes: number,
    label: string
  ): OffscreenLiveResourceLease {
    const token = Symbol(label)
    this.entries.set(token, { bytes, label })
    this.usedBytes += bytes
    return new OffscreenLiveResourceLease(this, token)
  }

  getUsedBytes(): number {
    return this.usedBytes
  }

  getCapacityBytes(): number {
    return this.capacityBytes
  }

  readBytes(token: symbol): number {
    return this.requireEntry(token).bytes
  }

  resize(token: symbol, bytes: number): void {
    this.assertBytes(bytes)
    const entry = this.requireEntry(token)
    const delta = bytes - entry.bytes
    if (delta > 0) this.assertCapacity(delta)
    entry.bytes = bytes
    this.usedBytes += delta
    if (delta < 0) this.drainPendingAcquisitions()
  }

  relabel(token: symbol, label: string): void {
    this.requireEntry(token).label = label
  }

  release(token: symbol): void {
    const entry = this.entries.get(token)
    if (!entry) return
    this.entries.delete(token)
    this.usedBytes -= entry.bytes
    this.drainPendingAcquisitions()
  }

  private assertCapacity(additionalBytes: number): void {
    const requestedBytes = this.usedBytes + additionalBytes
    if (requestedBytes > this.capacityBytes) {
      throw this.createCapacityError(requestedBytes)
    }
  }

  private createCapacityError(requestedBytes: number): Error {
    return new OffscreenLiveResourceLimitError(
      `Offscreen live resource cap exceeded (${requestedBytes}/${this.capacityBytes} bytes)`
    )
  }

  private hasCapacity(bytes: number): boolean {
    return this.usedBytes + bytes <= this.capacityBytes
  }

  private drainPendingAcquisitions(): void {
    while (this.pendingAcquisitions.length > 0) {
      const request = this.pendingAcquisitions[0]
      if (request.signal?.aborted) {
        this.pendingAcquisitions.shift()
        request.signal.removeEventListener("abort", request.onAbort)
        request.reject(this.readAbortReason(request.signal))
        continue
      }
      if (!this.hasCapacity(request.bytes)) return

      this.pendingAcquisitions.shift()
      request.signal?.removeEventListener("abort", request.onAbort)
      request.resolve(this.createLease(request.bytes, request.owner))
    }
  }

  private readAbortReason(signal: AbortSignal): Error {
    if (signal.reason instanceof Error) return signal.reason
    return new Error(
      typeof signal.reason === "string"
        ? signal.reason
        : "Offscreen live resource acquisition aborted"
    )
  }

  private assertBytes(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error("Offscreen live resource bytes must be a safe integer")
    }
  }

  private requireEntry(token: symbol): LedgerEntry {
    const entry = this.entries.get(token)
    if (!entry) {
      throw new Error("Offscreen live resource lease is not active")
    }
    return entry
  }
}
