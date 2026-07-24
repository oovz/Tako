import logger from "@/src/runtime/logger"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import type {
  DownloadTaskState,
  OutputAccounting,
  PendingOutputRecord,
} from "@/src/types/queue-state"
import type { PendingDownloadsStore } from "./pending-downloads"

export interface NativeOutputFinalizerDependencies {
  stateManager: CentralizedStateManager
  pendingOutputs: PendingDownloadsStore
  requestBlobRevocation: (
    record: Pick<
      PendingOutputRecord,
      "jobId" | "attempt" | "outputId" | "blobUrl"
    >
  ) => Promise<void>
  onOutputSettled?: () => Promise<void>
}

function toBlobRevocationRequest(
  record: PendingOutputRecord
): Pick<PendingOutputRecord, "jobId" | "attempt" | "outputId" | "blobUrl"> {
  return {
    jobId: record.jobId,
    attempt: record.attempt,
    outputId: record.outputId,
    blobUrl: record.blobUrl,
  }
}

async function revokeOrConfirmBlobReleased(
  deps: NativeOutputFinalizerDependencies,
  record: PendingOutputRecord
): Promise<void> {
  const offscreenApi = chrome.offscreen as
    { hasDocument?: () => Promise<boolean> } | undefined
  if (
    typeof offscreenApi?.hasDocument === "function" &&
    !(await offscreenApi.hasDocument())
  ) {
    // Blob URLs are scoped to the offscreen document. If its owner no longer
    // exists, the URL is already unusable and retaining the dependency would
    // permanently prevent cleanup.
    await deps.pendingOutputs.markBlobRevoked(record.outputId)
    return
  }

  // `REVOKE_BLOB_URL` intentionally has a strict four-field schema. Keep the
  // persistent pending-output bookkeeping out of this cross-context message;
  // otherwise valid terminal downloads retry cleanup forever after the
  // offscreen document rejects the extra fields.
  await deps.requestBlobRevocation(toBlobRevocationRequest(record))
  await deps.pendingOutputs.markBlobRevoked(record.outputId)
}

function equalAccounting(
  left: OutputAccounting | undefined,
  right: OutputAccounting
): boolean {
  return (
    left?.requested === right.requested &&
    left.committed === right.committed &&
    left.failed === right.failed
  )
}

export function summarizePendingChapterOutputs(input: {
  records: Iterable<PendingOutputRecord>
  taskId: string
  chapterId: string
  attempt?: number
  existing?: OutputAccounting
}): OutputAccounting | undefined {
  const matching = [...input.records].filter(
    (record) =>
      record.taskId === input.taskId &&
      record.chapterId === input.chapterId &&
      (input.attempt === undefined || record.attempt === input.attempt)
  )
  if (matching.length === 0) return input.existing

  const requested = Math.max(
    input.existing?.requested ?? 0,
    ...matching.map((record) => record.outputCount)
  )
  const committed = Math.max(
    input.existing?.committed ?? 0,
    matching.filter((record) => record.state === "complete").length
  )
  const failed = Math.max(
    input.existing?.failed ?? 0,
    matching.filter((record) => record.state === "interrupted").length
  )
  return { requested, committed, failed }
}

export function mergePendingOutputAccountingIntoQueue(input: {
  queue: DownloadTaskState[]
  records: Iterable<PendingOutputRecord>
}): { queue: DownloadTaskState[]; changed: boolean } {
  const records = [...input.records]
  let changed = false
  const queue = input.queue.map((task) => {
    let taskChanged = false
    let lastSuccessfulDownloadId = task.lastSuccessfulDownloadId
    const chapters = task.chapters.map((chapter) => {
      const accounting = summarizePendingChapterOutputs({
        records,
        taskId: task.id,
        chapterId: chapter.id,
        attempt: chapter.dispatchAttempt,
        existing: chapter.outputs,
      })
      if (!accounting || equalAccounting(chapter.outputs, accounting)) {
        return chapter
      }
      taskChanged = true
      return { ...chapter, outputs: accounting }
    })

    for (const record of records) {
      if (
        record.taskId === task.id &&
        record.state === "complete" &&
        record.downloadId !== undefined &&
        (lastSuccessfulDownloadId === undefined ||
          record.downloadId > lastSuccessfulDownloadId)
      ) {
        lastSuccessfulDownloadId = record.downloadId
        taskChanged = true
      }
    }

    if (!taskChanged) return task
    changed = true
    return { ...task, chapters, lastSuccessfulDownloadId }
  })
  return { queue, changed }
}

async function projectPendingOutputAccounting(
  deps: NativeOutputFinalizerDependencies,
  record: PendingOutputRecord
): Promise<void> {
  if (record.taskId === "legacy") return
  if (typeof deps.stateManager.getGlobalState !== "function") return
  const task = (await deps.stateManager.getGlobalState()).downloadQueue.find(
    (candidate) => candidate.id === record.taskId
  )
  if (!task || !Array.isArray(task.chapters)) return
  const chapter = task?.chapters.find(
    (candidate) => candidate.id === record.chapterId
  )
  if (!task || !chapter) {
    return
  }
  const outputs = summarizePendingChapterOutputs({
    records: deps.pendingOutputs.snapshot().values(),
    taskId: record.taskId,
    chapterId: record.chapterId,
    attempt: chapter.dispatchAttempt,
    existing: chapter.outputs,
  })
  if (!outputs) return

  if (task.status === "canceled" && chapter.status === "canceled") {
    if (!equalAccounting(chapter.outputs, outputs)) {
      await deps.stateManager.updateDownloadTaskChapter(
        record.taskId,
        record.chapterId,
        "canceled",
        {
          outputs,
          errorMessage: chapter.errorMessage,
          errorCategory: chapter.errorCategory,
        }
      )
    }
    return
  }
  if (task.status !== "downloading" || chapter.status !== "downloading") return

  const matchingRecords = [...deps.pendingOutputs.snapshot().values()].filter(
    (candidate) =>
      candidate.jobId === record.jobId &&
      candidate.attempt === record.attempt &&
      candidate.taskId === record.taskId &&
      candidate.chapterId === record.chapterId
  )
  const allTrackedTerminal = matchingRecords.every(
    (candidate) =>
      candidate.state === "complete" || candidate.state === "interrupted"
  )
  const offscreenApi = chrome.offscreen as
    { hasDocument?: () => Promise<boolean> } | undefined
  const offscreenAlive =
    typeof offscreenApi?.hasDocument === "function"
      ? await offscreenApi.hasDocument()
      : true
  const canFinishChapter =
    outputs.requested > 0 &&
    allTrackedTerminal &&
    (matchingRecords.length >= outputs.requested || !offscreenAlive)
  const terminalOutputs = canFinishChapter
    ? {
        ...outputs,
        failed: Math.max(outputs.failed, outputs.requested - outputs.committed),
      }
    : outputs
  const nextStatus = canFinishChapter
    ? terminalOutputs.committed === terminalOutputs.requested &&
      terminalOutputs.failed === 0
      ? "completed"
      : terminalOutputs.committed > 0
        ? "partial_success"
        : "failed"
    : "downloading"
  if (
    equalAccounting(chapter.outputs, terminalOutputs) &&
    nextStatus === "downloading"
  ) {
    return
  }
  await deps.stateManager.updateDownloadingTaskChapter(
    record.taskId,
    record.chapterId,
    nextStatus,
    {
      outputs: terminalOutputs,
      errorMessage:
        nextStatus === "completed"
          ? undefined
          : nextStatus === "downloading"
            ? chapter.errorMessage
            : "One or more output files did not finish saving.",
      errorCategory:
        nextStatus === "completed"
          ? undefined
          : nextStatus === "downloading"
            ? chapter.errorCategory
            : "browser_download_interrupted",
    }
  )
}

export async function finalizePendingOutput(
  deps: NativeOutputFinalizerDependencies,
  input: {
    downloadId: number
    state: "complete" | "interrupted"
    error?: string
  }
): Promise<PendingOutputRecord | undefined> {
  let record = deps.pendingOutputs.get(input.downloadId)
  if (!record) {
    await deps.pendingOutputs.hydrate()
    record = deps.pendingOutputs.get(input.downloadId)
  }
  if (!record) return undefined

  const terminalRecord = await deps.pendingOutputs.markTerminal(
    input.downloadId,
    input.state,
    input.error
  )
  if (!terminalRecord) return undefined

  if (
    terminalRecord.state === "complete" &&
    terminalRecord.taskId !== "legacy" &&
    terminalRecord.downloadId !== undefined
  ) {
    await deps.stateManager.updateDownloadTask(terminalRecord.taskId, {
      lastSuccessfulDownloadId: terminalRecord.downloadId,
    })
  }
  await projectPendingOutputAccounting(deps, terminalRecord)

  if (!terminalRecord.blobRevokedAt) {
    try {
      await revokeOrConfirmBlobReleased(deps, terminalRecord)
    } catch (error) {
      logger.warn("Blob URL revocation will be retried", {
        outputId: terminalRecord.outputId,
        downloadId: terminalRecord.downloadId,
        error,
      })
    }
  }

  await deps.onOutputSettled?.()
  return terminalRecord
}

export async function reconcilePendingOutput(
  deps: NativeOutputFinalizerDependencies,
  downloadId: number,
  options: { missingIsInterrupted?: boolean } = {}
): Promise<void> {
  const items = await chrome.downloads.search({ id: downloadId })
  const item = items[0]
  if (!item) {
    if (options.missingIsInterrupted) {
      await finalizePendingOutput(deps, {
        downloadId,
        state: "interrupted",
        error: "Native download record is unavailable",
      })
    }
    return
  }

  if (item.state === "complete") {
    await finalizePendingOutput(deps, { downloadId, state: "complete" })
  } else if (item.state === "interrupted") {
    await finalizePendingOutput(deps, {
      downloadId,
      state: "interrupted",
      error: item.error,
    })
  }
}

export async function reconcilePreparedOutput(
  deps: NativeOutputFinalizerDependencies,
  record: PendingOutputRecord,
  options: { missingIsInterrupted?: boolean } = {}
): Promise<PendingOutputRecord> {
  if (record.state !== "prepared") return record

  const matches = await chrome.downloads.search({ url: record.blobUrl })
  const recovered = matches
    .filter(
      (item) => typeof item.id === "number" && item.url === record.blobUrl
    )
    .sort((left, right) => right.id - left.id)[0]

  if (recovered) {
    const attached = await deps.pendingOutputs.attachDownload(
      record.outputId,
      recovered.id
    )
    if (attached) {
      await reconcilePendingOutput(deps, recovered.id)
      return deps.pendingOutputs.getByOutputId(record.outputId) ?? attached
    }
  }

  if (!options.missingIsInterrupted) return record

  const interrupted = await deps.pendingOutputs.markPreparedInterrupted(
    record.outputId,
    "Native download was not accepted before the service worker stopped"
  )
  if (!interrupted) return record
  if (!interrupted.blobRevokedAt) {
    try {
      await revokeOrConfirmBlobReleased(deps, interrupted)
    } catch (error) {
      logger.warn("Prepared Blob URL revocation will be retried", {
        outputId: interrupted.outputId,
        error,
      })
    }
  }
  await deps.onOutputSettled?.()
  return deps.pendingOutputs.getByOutputId(record.outputId) ?? interrupted
}

export async function reconcileAllPendingOutputs(
  deps: NativeOutputFinalizerDependencies
): Promise<void> {
  for (const record of deps.pendingOutputs.snapshot().values()) {
    try {
      if (record.state === "prepared") {
        await reconcilePreparedOutput(deps, record, {
          missingIsInterrupted: true,
        })
        continue
      }
      if (record.state === "in_progress") {
        if (record.downloadId === undefined) continue
        await reconcilePendingOutput(deps, record.downloadId, {
          missingIsInterrupted: true,
        })
        continue
      }

      if (!record.blobRevokedAt) {
        if (record.downloadId === undefined) {
          try {
            await revokeOrConfirmBlobReleased(deps, record)
          } catch (error) {
            logger.warn("Blob URL revocation will be retried", {
              outputId: record.outputId,
              error,
            })
          }
          continue
        }
        await finalizePendingOutput(deps, {
          downloadId: record.downloadId,
          state: record.state,
          error: record.error,
        })
      }
    } catch (error) {
      // A transient Chrome query/storage failure for one output must not keep
      // the service worker uninitialized. The durable record remains and the
      // liveness alarm retries it.
      logger.warn("Pending output reconciliation will be retried", {
        outputId: record.outputId,
        error,
      })
    }
  }
}
