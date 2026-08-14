import type { RuntimeMessageHandlerMap } from "@/src/runtime/runtime-message-dispatcher"
import type {
  OffscreenInitializationState,
  RuntimeMessageRequest,
  RuntimeMessageResponse,
} from "@/src/runtime/runtime-message-contracts"
import type { OffscreenJobState } from "@/src/runtime/offscreen-job-contracts"

type OffscreenDownloadChapterPayload =
  RuntimeMessageRequest<"OFFSCREEN_DOWNLOAD_CHAPTER">["payload"]
type OffscreenParseSeriesHtmlPayload =
  RuntimeMessageRequest<"OFFSCREEN_PARSE_SERIES_HTML">["payload"]

export interface OffscreenWorkerRuntime {
  readonly documentInstanceId: string
  initialize: () => Promise<void>
  processDownloadChapter: (
    payload: OffscreenDownloadChapterPayload
  ) => Promise<
    Omit<
      Extract<
        RuntimeMessageResponse<"OFFSCREEN_DOWNLOAD_CHAPTER">,
        { success: true }
      >,
      "success"
    >
  >
  parseSeriesHtml: (
    payload: OffscreenParseSeriesHtmlPayload
  ) => Promise<RuntimeMessageResponse<"OFFSCREEN_PARSE_SERIES_HTML">>
  cancelSeriesHtml: (requestId: string) => boolean
  cancelJob: (
    input: RuntimeMessageRequest<"OFFSCREEN_CANCEL_JOB">["payload"]
  ) => Omit<
    Extract<RuntimeMessageResponse<"OFFSCREEN_CANCEL_JOB">, { success: true }>,
    "success"
  >
  revokeBlobUrl: (
    input: RuntimeMessageRequest<"REVOKE_BLOB_URL">["payload"]
  ) => boolean
  getJobState: (
    input: RuntimeMessageRequest<"OFFSCREEN_CANCEL_JOB">["payload"]
  ) => OffscreenJobState | null
  getActiveJobCount: () => number
  getActiveSeriesResolutionCount: () => number
  getActiveTaskIds: () => string[]
}

export function createOffscreenRuntimeMessageHandlers(
  worker: OffscreenWorkerRuntime,
  getInitializationState: () => OffscreenInitializationState
): RuntimeMessageHandlerMap<"offscreen"> {
  return {
    OFFSCREEN_DOWNLOAD_CHAPTER: async (message) => ({
      success: true,
      ...(await worker.processDownloadChapter(message.payload)),
    }),
    OFFSCREEN_STATUS: () => ({
      success: true,
      initializationState: getInitializationState(),
      documentInstanceId: worker.documentInstanceId,
      activeJobCount: worker.getActiveJobCount(),
      activeSeriesResolutionCount: worker.getActiveSeriesResolutionCount(),
      activeTaskIds: [...new Set(worker.getActiveTaskIds())].sort(
        (left, right) => left.localeCompare(right)
      ),
    }),
    OFFSCREEN_QUERY_JOB: (message) => ({
      success: true,
      requestId: message.payload.requestId,
      job: worker.getJobState(message.payload.identity),
    }),
    OFFSCREEN_CANCEL_JOB: (message) => ({
      success: true,
      ...worker.cancelJob(message.payload),
    }),
    OFFSCREEN_PARSE_SERIES_HTML: async (message) =>
      await worker.parseSeriesHtml(message.payload),
    OFFSCREEN_CANCEL_SERIES_HTML: (message) => ({
      success: true,
      canceled: worker.cancelSeriesHtml(message.payload.requestId),
    }),
    REVOKE_BLOB_URL: (message) =>
      worker.revokeBlobUrl(message.payload)
        ? { success: true }
        : {
            success: false,
            error: "Blob URL identity does not match a pending output",
          },
  }
}
