export type NativeOutputKind = "archive" | "image"

export interface NativeOutputJobIdentity {
  jobId: string
  attempt: number
  taskId: string
  chapterId: string
  fingerprint: string
  documentInstanceId: string
}

export interface NativeOutputIdentity extends NativeOutputJobIdentity {
  outputId: string
  outputIndex: number
  outputCount: number
  blobUrl: string
  filename: string
  outputKind: NativeOutputKind
}

export type NativeOutputManifestSlot =
  | { disposition: "tracked"; outputId: string }
  | {
      disposition: "untracked_failed"
      failedAt: number
      error: string
    }

export interface NativeOutputManifest extends NativeOutputJobIdentity {
  phase: "open" | "sealed"
  outputsRequested: number
  outputsFailedBeforeHandoff: number
  slots: Array<NativeOutputManifestSlot | null>
  createdAt: number
  sealedAt?: number
  dependencyReleasedAt?: number
}

export type NativeOutputPhase =
  | "prepared"
  | "acceptance_unknown"
  | "waiting"
  | "complete"
  | "interrupted"
  | "surrendered"

export type NativeOutputAccountingDisposition =
  "pending" | "accounted" | "not_owner"

export interface NativeOutputRecord extends NativeOutputIdentity {
  phase: NativeOutputPhase
  createdAt: number
  acceptanceStartedAt?: number
  downloadId?: number
  terminalAt?: number
  error?: string
  erasedAt?: number
  /** Set when the user surrenders observation of an erased download (FORGET). */
  surrenderedAt?: number
  accountingDisposition: NativeOutputAccountingDisposition
  accountingDispositionAt?: number
  blobReleasedAt?: number
  dependencyReleasedAt?: number
}

export interface NativeOutputState {
  manifestsByJobId: Record<string, NativeOutputManifest>
  outputsByOutputId: Record<string, NativeOutputRecord>
}

export function createEmptyNativeOutputState(): NativeOutputState {
  return {
    manifestsByJobId: {},
    outputsByOutputId: {},
  }
}

export function nativeOutputJobIdentityMatches(
  left: NativeOutputJobIdentity,
  right: NativeOutputJobIdentity
): boolean {
  return (
    left.jobId === right.jobId &&
    left.attempt === right.attempt &&
    left.taskId === right.taskId &&
    left.chapterId === right.chapterId &&
    left.fingerprint === right.fingerprint &&
    left.documentInstanceId === right.documentInstanceId
  )
}

export function nativeOutputIdentityMatches(
  left: NativeOutputIdentity,
  right: NativeOutputIdentity
): boolean {
  return (
    nativeOutputJobIdentityMatches(left, right) &&
    left.outputId === right.outputId &&
    left.outputIndex === right.outputIndex &&
    left.outputCount === right.outputCount &&
    left.blobUrl === right.blobUrl &&
    left.filename === right.filename &&
    left.outputKind === right.outputKind
  )
}

export function isNativeOutputTerminal(record: NativeOutputRecord): boolean {
  return record.phase === "complete" || record.phase === "interrupted"
}

export function isNativeOutputAcceptanceProvenAbsent(
  record: NativeOutputRecord
): boolean {
  if (record.phase === "surrendered") return true
  return (
    record.downloadId === undefined &&
    (record.phase === "prepared" || record.phase === "interrupted")
  )
}

/** True when the record is waiting on an erased Chrome download the user has not resolved yet. */
export function isNativeOutputUnobservable(
  record: NativeOutputRecord
): boolean {
  return record.phase === "waiting" && record.erasedAt !== undefined
}

export function isNativeOutputLive(record: NativeOutputRecord): boolean {
  return (
    record.phase === "acceptance_unknown" ||
    record.phase === "waiting" ||
    !isNativeOutputTerminal(record) ||
    record.accountingDisposition === "pending" ||
    record.blobReleasedAt === undefined ||
    record.dependencyReleasedAt === undefined
  )
}
