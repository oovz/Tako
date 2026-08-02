import logger from "@/src/runtime/logger"
import type {
  OffscreenDownloadChapterMessage,
  OffscreenDownloadChapterResponse,
  OffscreenJobState,
} from "@/src/types/offscreen-messages"
import { queryOffscreenJob } from "./offscreen-lifecycle"

function isSameOffscreenJob(
  job: OffscreenJobState,
  message: OffscreenDownloadChapterMessage
): boolean {
  return (
    job.jobId === message.payload.jobId &&
    job.attempt === message.payload.attempt &&
    job.taskId === message.payload.taskId &&
    job.chapterId === message.payload.chapter.id
  )
}

function responseFromTerminalJob(
  job: OffscreenJobState | null,
  message: OffscreenDownloadChapterMessage
): OffscreenDownloadChapterResponse | undefined {
  if (
    !job ||
    !isSameOffscreenJob(job, message) ||
    job.status !== "terminal" ||
    !job.outcome
  ) {
    return undefined
  }

  return {
    success: true,
    status: job.outcome.status,
    errorMessage: job.outcome.errorMessage,
    errorCategory: job.outcome.errorCategory,
    imagesFailed: job.outcome.imagesFailed,
    outputsRequested: job.outcome.outputsRequested,
    outputsFailedBeforeHandoff: job.outcome.outputsFailedBeforeHandoff,
    outputsCommitted: job.outcome.outputsCommitted,
  }
}

async function queryTerminalJobResponse(
  message: OffscreenDownloadChapterMessage
): Promise<OffscreenDownloadChapterResponse | undefined> {
  try {
    return responseFromTerminalJob(await queryOffscreenJob(), message)
  } catch (error) {
    logger.warn("[Queue] Unable to reconcile a closed dispatch channel", {
      jobId: message.payload.jobId,
      attempt: message.payload.attempt,
      error,
    })
    return undefined
  }
}

const RECOVERABLE_TRANSPORT_ERRORS = [
  "Could not establish connection. Receiving end does not exist.",
  "The message port closed before a response was received.",
  "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received.",
  "Extension context invalidated.",
] as const

export function isRecoverableOffscreenTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return RECOVERABLE_TRANSPORT_ERRORS.some((transportError) =>
    message.includes(transportError)
  )
}

/**
 * Reattach to an idempotent offscreen job when its original response channel
 * closes after the job was accepted. The caller supplies the durable
 * task/chapter/lease check so replay cannot resurrect stale work.
 */
export async function dispatchOffscreenChapterWithRecovery(input: {
  message: OffscreenDownloadChapterMessage
  ensureOffscreenReady: () => Promise<void>
  isDispatchStillCurrent: () => Promise<boolean>
}): Promise<OffscreenDownloadChapterResponse> {
  try {
    return await chrome.runtime.sendMessage(input.message)
  } catch (initialError) {
    const recovered = await queryTerminalJobResponse(input.message)
    if (recovered) return recovered

    if (!isRecoverableOffscreenTransportError(initialError)) {
      throw initialError
    }

    if (!(await input.isDispatchStillCurrent())) {
      throw initialError
    }

    logger.warn("[Queue] Reattaching to accepted offscreen job", {
      jobId: input.message.payload.jobId,
      attempt: input.message.payload.attempt,
    })
    await input.ensureOffscreenReady()
    if (!(await input.isDispatchStillCurrent())) {
      throw initialError
    }

    try {
      return await chrome.runtime.sendMessage(input.message)
    } catch (retryError) {
      const terminalResponse = await queryTerminalJobResponse(input.message)
      if (terminalResponse) return terminalResponse
      throw retryError
    }
  }
}
