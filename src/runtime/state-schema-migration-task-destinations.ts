import { nativeOutputJobIdentityMatches } from "@/src/domain/native-output/state"
import { validateResolvedPath } from "@/src/shared/download-path-validator"
import { ActiveDispatchLeaseSchema } from "./state-schema-migration-queue-schemas"
import { z } from "zod"
import {
  DownloadTaskStateSchema,
  PendingUndoActionSchema,
} from "./state-schema-migration-task-destination-schemas"
import {
  Epoch5DownloadTaskStateSchema,
  Epoch5PendingUndoActionSchema,
  readEpoch5NativeOutputState,
} from "./state-schema-migration-save-evidence"
import { captureRequestedOutputPath } from "./task-output-path"
import { LOCAL_STORAGE_KEYS } from "./storage-keys"

const ERROR =
  "The original download folder was not recorded. Create a new task with a selected destination."

type SourceNativeState = ReturnType<typeof readEpoch5NativeOutputState>
type SourceTask = z.infer<typeof Epoch5DownloadTaskStateSchema>
type SourceChapter = SourceTask["chapters"][number]
type SourceLease = z.infer<typeof ActiveDispatchLeaseSchema> | null

function recordedRequestedPath(
  task: SourceTask,
  chapter: SourceChapter,
  native: SourceNativeState,
  lease: SourceLease
): string | null {
  const settlement = chapter.nativeOutputSettlement
  const reference =
    settlement?.taskId === task.id && settlement.chapterId === chapter.id
      ? settlement
      : lease?.taskId === task.id &&
          lease.chapterId === chapter.id &&
          lease.attempt === chapter.dispatchAttempt
        ? lease
        : null
  if (!reference) return null
  const manifest = native.manifestsByJobId[reference.jobId]
  if (
    !manifest ||
    manifest.taskId !== task.id ||
    manifest.chapterId !== chapter.id ||
    manifest.attempt !== reference.attempt
  )
    return null
  if (
    reference === lease &&
    (manifest.fingerprint !== lease.fingerprint ||
      manifest.documentInstanceId !== lease.documentInstanceId)
  )
    return null
  const records = manifest.slots.map((slot) =>
    slot?.disposition === "tracked"
      ? native.outputsByOutputId[slot.outputId]
      : undefined
  )
  const tracked = records.filter(
    (record): record is NonNullable<typeof record> => record !== undefined
  )
  if (
    tracked.length === 0 ||
    tracked.some(
      (record) =>
        !nativeOutputJobIdentityMatches(record, manifest) ||
        !validateResolvedPath(record.filename).isValid
    )
  )
    return null
  if (task.settingsSnapshot.archiveFormat !== "none")
    return tracked.length === 1 &&
      tracked[0].outputKind === "archive" &&
      tracked[0].outputCount === 1
      ? tracked[0].filename
      : null
  if (tracked.some((record) => record.outputKind !== "image")) return null
  const paths = tracked.map((record) => {
    const separator = record.filename.lastIndexOf("/")
    return separator > 0 ? record.filename.slice(0, separator) : null
  })
  return paths[0] && paths.every((path) => path === paths[0]) ? paths[0] : null
}

function convertTask(
  task: SourceTask,
  native: SourceNativeState,
  lease: SourceLease
) {
  const { destinationOverride, ...original } = task
  const destination =
    destinationOverride === "downloads-api" ||
    task.settingsSnapshot.destination === "downloads-api"
      ? { kind: "downloads-api" as const }
      : { kind: "file-system-access" as const, handleId: null }
  let pathUnavailable = false
  const pathFor = (chapter: (typeof task.chapters)[number]): string | null => {
    const dated = /<(?:YYYY|MM|DD)>/.test(
      task.settingsSnapshot.pathTemplate +
        task.settingsSnapshot.fileNameTemplate
    )
    const dispatched =
      (chapter.status !== "queued" && chapter.status !== "skipped") ||
      chapter.dispatchAttempt !== undefined ||
      chapter.nativeOutputSettlement !== undefined ||
      (chapter.outputs?.requested ?? 0) > 0
    if (dated && dispatched) {
      const recorded = recordedRequestedPath(task, chapter, native, lease)
      if (recorded === null) pathUnavailable = true
      return recorded
    }
    try {
      return captureRequestedOutputPath(task, chapter)
    } catch {
      pathUnavailable = true
      return null
    }
  }
  const captured = task.chapters.map((chapter) => ({
    ...chapter,
    requestedPath: pathFor(chapter),
  }))
  const unfinished =
    (destination.kind === "file-system-access" || pathUnavailable) &&
    (task.status === "queued" || task.status === "downloading")
  const destinationError = pathUnavailable
    ? "The original requested path cannot be recovered. Create a new task."
    : ERROR
  const chapters = captured.map((chapter) => ({
    ...chapter,
    ...(unfinished &&
    (chapter.status === "queued" || chapter.status === "downloading")
      ? {
          status:
            (chapter.outputs?.committed ?? 0) > 0
              ? ("partial_success" as const)
              : ("failed" as const),
          outputs: chapter.outputs
            ? {
                ...chapter.outputs,
                failed: Math.max(
                  chapter.outputs.failed,
                  chapter.outputs.requested - chapter.outputs.committed
                ),
              }
            : undefined,
          lastUpdated: Date.now(),
          errorMessage: destinationError,
          errorCategory: "folder_unavailable" as const,
        }
      : {}),
  }))
  const firstFailure = chapters.find(
    (chapter) =>
      chapter.status === "failed" || chapter.status === "partial_success"
  )
  const anySaved = chapters.some(
    (chapter) =>
      chapter.status === "completed" || (chapter.outputs?.committed ?? 0) > 0
  )
  return DownloadTaskStateSchema.parse({
    ...original,
    chapters,
    settingsSnapshot: { ...task.settingsSnapshot, destination },
    ...(destination.kind === "downloads-api" &&
    task.activeBlock === "destination_action_required"
      ? { activeBlock: undefined, destinationIssue: undefined }
      : {}),
    ...(unfinished
      ? {
          status: anySaved ? "partial_success" : "failed",
          activeBlock: undefined,
          destinationIssue: undefined,
          destinationResume: undefined,
          nextChapterDispatchAt: undefined,
          completed: Date.now(),
          errorMessage: firstFailure?.errorMessage ?? destinationError,
          errorCategory: firstFailure?.errorCategory ?? "folder_unavailable",
        }
      : {}),
  })
}

export function buildTaskDestinationWrites(
  stored: Record<string, unknown>
): Record<string, unknown> {
  const queue = z
    .array(Epoch5DownloadTaskStateSchema)
    .parse(
      stored[LOCAL_STORAGE_KEYS.downloadQueue] === undefined
        ? []
        : stored[LOCAL_STORAGE_KEYS.downloadQueue]
    )
  const undo = z
    .array(Epoch5PendingUndoActionSchema)
    .parse(
      stored[LOCAL_STORAGE_KEYS.pendingUndoActions] === undefined
        ? []
        : stored[LOCAL_STORAGE_KEYS.pendingUndoActions]
    )
  const native = readEpoch5NativeOutputState(stored)
  const lease = ActiveDispatchLeaseSchema.nullable().parse(
    stored[LOCAL_STORAGE_KEYS.activeDispatchLease] === undefined
      ? null
      : stored[LOCAL_STORAGE_KEYS.activeDispatchLease]
  )
  return {
    [LOCAL_STORAGE_KEYS.downloadQueue]: queue.map((task) =>
      convertTask(task, native, lease)
    ),
    [LOCAL_STORAGE_KEYS.pendingUndoActions]: undo.map((action) =>
      PendingUndoActionSchema.parse({
        ...action,
        taskSnapshot: convertTask(action.taskSnapshot, native, lease),
      })
    ),
  }
}
