import type { NativeOutputRecord } from "@/src/domain/native-output/state"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"

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
}
