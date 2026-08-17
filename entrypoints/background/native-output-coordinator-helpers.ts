import type {
  RuntimeMessageRequest,
  RuntimeMessageResponse,
} from "@/src/runtime/runtime-message-contracts"
import type {
  NativeOutputIdentity,
  NativeOutputManifest,
  NativeOutputRecord,
} from "@/src/domain/native-output/state"
import type { OffscreenJobState } from "@/src/runtime/offscreen-job-contracts"

export type OutputReadyPayload =
  RuntimeMessageRequest<"OFFSCREEN_OUTPUT_READY">["payload"]
export type OutputReadyResponse =
  RuntimeMessageResponse<"OFFSCREEN_OUTPUT_READY">

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
  if (record.phase === "complete" || record.phase === "interrupted") {
    return {
      success: true,
      disposition: "tracked",
      phase: record.phase,
      terminalOutcome: record.phase,
    }
  }
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
  surrendered: number
  interrupted: number
  lastSuccessfulDownloadId: number | undefined
}

export function calculateNativeOutputSettlementStats(
  manifest: NativeOutputManifest,
  records: NativeOutputRecord[]
): NativeOutputSettlementStats {
  const completed = records.filter(
    (record) => record.phase === "complete"
  ).length
  const surrendered = records.filter(
    (record) => record.phase === "surrendered"
  ).length
  const interrupted = manifest.outputsRequested - completed - surrendered
  const lastSuccessfulDownloadId = records.reduce<number | undefined>(
    (latest, record) =>
      record.phase === "complete" &&
      record.downloadId !== undefined &&
      (latest === undefined || record.downloadId > latest)
        ? record.downloadId
        : latest,
    undefined
  )
  return {
    completed,
    surrendered,
    interrupted,
    lastSuccessfulDownloadId,
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
