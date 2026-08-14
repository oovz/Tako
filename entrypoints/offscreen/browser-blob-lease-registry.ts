import {
  MAX_CHAPTER_IMAGES,
  MAX_CHAPTER_IMAGE_BYTES,
  MAX_METADATA_RESPONSE_BYTES,
} from "@/src/constants/timeouts"
import type { BlobUrlIdentity } from "@/src/runtime/offscreen-job-contracts"
import type {
  OffscreenLiveResourceLedger,
  OffscreenLiveResourceLease,
} from "@/src/runtime/offscreen-live-resource-ledger"

export const MAX_BROWSER_BLOB_LEASE_COUNT = MAX_CHAPTER_IMAGES + 2
export const MAX_BROWSER_BLOB_RETAINED_BYTES =
  MAX_CHAPTER_IMAGE_BYTES + MAX_METADATA_RESPONSE_BYTES

type BrowserBlobLease = BlobUrlIdentity & {
  bytes: number
  resourceLease?: OffscreenLiveResourceLease
}

type BrowserBlobLeaseInput = Omit<BlobUrlIdentity, "blobUrl"> & {
  blob: Blob
  resourceLease?: OffscreenLiveResourceLease
}

/** Owns every browser Blob URL until an exact background revocation arrives. */
export class BrowserBlobLeaseRegistry {
  private readonly leases = new Map<string, BrowserBlobLease>()
  private retainedBytes = 0
  private disposed = false

  constructor(
    private readonly limits: {
      maxCount: number
      maxBytes: number
    } = {
      maxCount: MAX_BROWSER_BLOB_LEASE_COUNT,
      maxBytes: MAX_BROWSER_BLOB_RETAINED_BYTES,
    },
    private readonly urls: Pick<
      typeof URL,
      "createObjectURL" | "revokeObjectURL"
    > = URL,
    private readonly resourceLedger?: OffscreenLiveResourceLedger
  ) {}

  retain(input: BrowserBlobLeaseInput): BlobUrlIdentity {
    if (this.disposed)
      throw new Error("Browser Blob lease registry is disposed")
    if (this.leases.has(input.outputId)) {
      throw new Error("Blob output identity collision")
    }
    if (this.leases.size + 1 > this.limits.maxCount) {
      throw new Error("Browser Blob lease count limit exceeded")
    }
    const nextBytes = this.retainedBytes + input.blob.size
    if (nextBytes > this.limits.maxBytes) {
      throw new Error("Browser Blob retained byte limit exceeded")
    }

    if (this.resourceLedger && !input.resourceLease) {
      throw new Error("Browser Blob is missing its live resource lease")
    }
    if (input.resourceLease && input.resourceLease.bytes !== input.blob.size) {
      throw new Error("Browser Blob live resource lease size mismatch")
    }

    const resourceLease = input.resourceLease?.transfer(
      `browser Blob ${input.outputId}`
    )
    let blobUrl: string
    try {
      blobUrl = this.urls.createObjectURL(input.blob)
    } catch (error) {
      resourceLease?.release()
      throw error
    }
    const lease: BrowserBlobLease = {
      jobId: input.jobId,
      attempt: input.attempt,
      taskId: input.taskId,
      chapterId: input.chapterId,
      fingerprint: input.fingerprint,
      documentInstanceId: input.documentInstanceId,
      outputId: input.outputId,
      blobUrl,
      bytes: input.blob.size,
      resourceLease,
    }
    this.leases.set(input.outputId, lease)
    this.retainedBytes = nextBytes
    return this.toIdentity(lease)
  }

  revoke(input: BlobUrlIdentity): boolean {
    const lease = this.leases.get(input.outputId)
    if (!lease) return true
    if (!this.matches(lease, input)) return false
    this.urls.revokeObjectURL(lease.blobUrl)
    this.leases.delete(input.outputId)
    this.retainedBytes -= lease.bytes
    lease.resourceLease?.release()
    return true
  }

  getRetainedCount(): number {
    return this.leases.size
  }

  getRetainedBytes(): number {
    return this.retainedBytes
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const lease of this.leases.values()) {
      this.urls.revokeObjectURL(lease.blobUrl)
      lease.resourceLease?.release()
    }
    this.leases.clear()
    this.retainedBytes = 0
  }

  private matches(left: BrowserBlobLease, right: BlobUrlIdentity): boolean {
    return (
      left.jobId === right.jobId &&
      left.attempt === right.attempt &&
      left.taskId === right.taskId &&
      left.chapterId === right.chapterId &&
      left.fingerprint === right.fingerprint &&
      left.documentInstanceId === right.documentInstanceId &&
      left.outputId === right.outputId &&
      left.blobUrl === right.blobUrl
    )
  }

  private toIdentity(lease: BrowserBlobLease): BlobUrlIdentity {
    return {
      jobId: lease.jobId,
      attempt: lease.attempt,
      taskId: lease.taskId,
      chapterId: lease.chapterId,
      fingerprint: lease.fingerprint,
      documentInstanceId: lease.documentInstanceId,
      outputId: lease.outputId,
      blobUrl: lease.blobUrl,
    }
  }
}
