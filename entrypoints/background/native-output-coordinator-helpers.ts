import type { DispatchLeaseAuthority } from "@/src/domain/queue/state"
import {
  canAccountNativeOutput,
  nativeOutputJobIdentityMatches,
} from "@/src/domain/native-output/state"
import type { DownloadErrorCategory } from "@/src/shared/download-contract"
import type {
  RuntimeMessageRequest,
  RuntimeMessageResponse,
} from "@/src/runtime/runtime-message-contracts"
import type {
  NativeOutputIdentity,
  NativeOutputJobIdentity,
  NativeOutputManifest,
  NativeOutputState,
  NativeOutputRecord,
} from "@/src/domain/native-output/state"
import type { OffscreenJobState } from "@/src/runtime/offscreen-job-contracts"

export type OutputReadyPayload =
  RuntimeMessageRequest<"OFFSCREEN_OUTPUT_READY">["payload"]
export type OutputReadyResponse =
  RuntimeMessageResponse<"OFFSCREEN_OUTPUT_READY">

export function ownsNativeOutputProducer(
  lease: DispatchLeaseAuthority | null,
  identity: NativeOutputJobIdentity
): boolean {
  if (!lease || lease.documentInstanceId === undefined) return false
  return nativeOutputJobIdentityMatches(
    { ...lease, documentInstanceId: lease.documentInstanceId },
    identity
  )
}

export function toIdentity(payload: OutputReadyPayload): NativeOutputIdentity {
  return {
    jobId: payload.jobId,
    attempt: payload.attempt,
    taskId: payload.taskId,
    chapterId: payload.chapterId,
    fingerprint: payload.fingerprint,
    documentInstanceId: payload.documentInstanceId,
    outputId: payload.outputId,
    outputIndex: payload.outputIndex,
    outputCount: payload.outputCount,
    blobUrl: payload.fileUrl,
    filename: payload.filename,
    outputKind: payload.outputKind,
  }
}

export function trackedResponse(
  record: NativeOutputRecord
): OutputReadyResponse {
  return { success: true, disposition: "tracked", phase: record.phase }
}

export function notPersistedResponse(reason: string): OutputReadyResponse {
  return { success: true, disposition: "not_persisted", reason }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isValidDownloadId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

export function manifestTrackedOutputIds(
  manifest: NativeOutputManifest
): string[] {
  return manifest.slots.flatMap((slot) =>
    slot?.disposition === "tracked" ? [slot.outputId] : []
  )
}

export interface NativeOutputSettlementStats {
  completed: number
  interrupted: number
  outputUncertain: boolean
  lastSuccessfulDownloadId: number | undefined
  errorMessage: string | undefined
  errorCategory: DownloadErrorCategory | undefined
}

function lastCompletedDownloadId(
  records: NativeOutputRecord[]
): number | undefined {
  return records.reduce<number | undefined>(
    (latest, record) =>
      record.phase === "complete" &&
      record.downloadId !== undefined &&
      (latest === undefined || record.downloadId > latest)
        ? record.downloadId
        : latest,
    undefined
  )
}

export function calculateNativeOutputSettlementStats(
  manifest: NativeOutputManifest,
  records: NativeOutputRecord[]
): NativeOutputSettlementStats {
  const completed = records.filter(
    (record) => record.phase === "complete"
  ).length
  const firstUnsuccessful =
    records.find((record) => record.phase === "interrupted") ??
    records.find((record) => record.phase === "outcome_unknown")
  const interrupted = manifest.outputsRequested - completed
  return {
    completed,
    interrupted,
    outputUncertain: records.some(
      (record) => record.phase === "outcome_unknown"
    ),
    lastSuccessfulDownloadId: lastCompletedDownloadId(records),
    errorMessage: manifest.errorMessage ?? firstUnsuccessful?.error,
    errorCategory:
      manifest.errorCategory ??
      (firstUnsuccessful?.phase === "outcome_unknown"
        ? "browser_output_unconfirmed"
        : firstUnsuccessful
          ? "browser_download_interrupted"
          : undefined),
  }
}

export function classifyProducerStoppedError(
  status: OffscreenJobState["status"] | undefined
): string {
  if (status === "canceled") {
    return "Offscreen producer was canceled before every output was handed off"
  }
  if (status === "terminal") {
    return "Offscreen producer stopped before every output was handed off"
  }
  return "Offscreen producer was absent during native output reconciliation"
}

export function manifestRecords(
  snapshot: NativeOutputState,
  manifest: NativeOutputManifest
): NativeOutputRecord[] {
  return manifestTrackedOutputIds(manifest).flatMap((outputId) => {
    const record = snapshot.outputsByOutputId[outputId]
    return record ? [record] : []
  })
}

export function allTrackedDependenciesReleased(
  snapshot: NativeOutputState,
  manifest: NativeOutputManifest
): boolean {
  return manifestTrackedOutputIds(manifest).every((outputId) => {
    const record = snapshot.outputsByOutputId[outputId]
    return record === undefined || record.dependencyReleasedAt !== undefined
  })
}

export function manifestAccountingResolved(
  manifest: NativeOutputManifest,
  records: NativeOutputRecord[]
): boolean {
  return (
    manifest.settlementAcknowledgedAt !== undefined ||
    (records.length === manifestTrackedOutputIds(manifest).length &&
      records.length > 0 &&
      records.every((record) => record.accountingDisposition !== "pending"))
  )
}

export function manifestReadyForAccounting(
  manifest: NativeOutputManifest,
  records: NativeOutputRecord[],
  settlementResolved: boolean
): boolean {
  return (
    manifest.phase === "sealed" &&
    !settlementResolved &&
    records.length === manifestTrackedOutputIds(manifest).length &&
    records.every(canAccountNativeOutput)
  )
}

export function settlementContinuationReady(
  manifest: NativeOutputManifest,
  queueSettlementProven: boolean,
  settlementResolved: boolean,
  dependenciesReleased: boolean
): boolean {
  return (
    manifest.phase === "sealed" &&
    manifest.dependencyReleasedAt === undefined &&
    (queueSettlementProven ||
      settlementResolved ||
      (manifestTrackedOutputIds(manifest).length > 0 && dependenciesReleased))
  )
}
