import type { NativeOutputRecord } from "@/src/domain/native-output/state"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import {
  hasOffscreenDocument,
  queryOffscreenStatus,
} from "./offscreen-lifecycle"

export async function isBlobProducerAbsent(
  documentInstanceId: string
): Promise<boolean> {
  if (!(await hasOffscreenDocument())) return true
  const status = await queryOffscreenStatus()
  return status !== null && status.documentInstanceId !== documentInstanceId
}

export async function requestBlobRevocation(
  record: Pick<
    NativeOutputRecord,
    | "jobId"
    | "attempt"
    | "taskId"
    | "chapterId"
    | "fingerprint"
    | "documentInstanceId"
    | "outputId"
    | "blobUrl"
  >
): Promise<void> {
  if (import.meta.env.FIREFOX && !(await hasOffscreenDocument())) return
  try {
    const response = await sendRuntimeMessage({
      target: "offscreen",
      type: "REVOKE_BLOB_URL",
      payload: {
        jobId: record.jobId,
        attempt: record.attempt,
        taskId: record.taskId,
        chapterId: record.chapterId,
        fingerprint: record.fingerprint,
        documentInstanceId: record.documentInstanceId,
        outputId: record.outputId,
        blobUrl: record.blobUrl,
      },
    })
    if (!response.success) throw new Error(response.error)
  } catch (error) {
    // Firefox's Blob URL is tied to its producer iframe. A replacement
    // iframe cannot own a URL from the previous document.
    if (
      import.meta.env.FIREFOX &&
      (await isBlobProducerAbsent(record.documentInstanceId))
    )
      return
    throw error
  }
}
