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

type SourceManifest = SourceNativeState["manifestsByJobId"][string]
type SourceOutput = SourceNativeState["outputsByOutputId"][string]
type SourceReference =
  | NonNullable<SourceChapter["nativeOutputSettlement"]>
  | NonNullable<SourceLease>

function chapterSettlement(task: SourceTask, chapter: SourceChapter) {
  const settlement = chapter.nativeOutputSettlement
  return settlement?.taskId === task.id && settlement.chapterId === chapter.id
    ? settlement
    : null
}

function chapterLease(
  task: SourceTask,
  chapter: SourceChapter,
  lease: SourceLease
) {
  return lease?.taskId === task.id &&
    lease.chapterId === chapter.id &&
    lease.attempt === chapter.dispatchAttempt
    ? lease
    : null
}

function referenceMatchesManifest(
  manifest: SourceManifest | undefined,
  reference: SourceReference,
  task: SourceTask,
  chapter: SourceChapter
): manifest is SourceManifest {
  return (
    manifest !== undefined &&
    manifest.taskId === task.id &&
    manifest.chapterId === chapter.id &&
    manifest.attempt === reference.attempt
  )
}

function leaseMatchesManifest(
  manifest: SourceManifest,
  reference: SourceReference,
  lease: SourceLease
): boolean {
  if (reference !== lease) return true
  return (
    manifest.fingerprint === lease.fingerprint &&
    manifest.documentInstanceId === lease.documentInstanceId
  )
}

function trackedManifestOutputs(
  manifest: SourceManifest,
  native: SourceNativeState
): SourceOutput[] {
  const records = manifest.slots.map((slot) =>
    slot?.disposition === "tracked"
      ? native.outputsByOutputId[slot.outputId]
      : undefined
  )
  return records.filter(
    (record): record is SourceOutput => record !== undefined
  )
}

function looseRequestedPath(outputs: SourceOutput[]): string | null {
  if (outputs.some((output) => output.outputKind !== "image")) return null
  const paths = outputs.map((output) => {
    const separator = output.filename.lastIndexOf("/")
    return separator > 0 ? output.filename.slice(0, separator) : null
  })
  return paths[0] && paths.every((path) => path === paths[0]) ? paths[0] : null
}

function archiveRequestedPath(outputs: SourceOutput[]): string | null {
  return outputs.length === 1 &&
    outputs[0].outputKind === "archive" &&
    outputs[0].outputCount === 1
    ? outputs[0].filename
    : null
}

function recordedRequestedPath(
  task: SourceTask,
  chapter: SourceChapter,
  native: SourceNativeState,
  lease: SourceLease
): string | null {
  const reference =
    chapterSettlement(task, chapter) ?? chapterLease(task, chapter, lease)
  if (!reference) return null
  const manifest = native.manifestsByJobId[reference.jobId]
  if (!referenceMatchesManifest(manifest, reference, task, chapter)) return null
  if (!leaseMatchesManifest(manifest, reference, lease)) return null
  const tracked = trackedManifestOutputs(manifest, native)
  if (
    tracked.length === 0 ||
    tracked.some(
      (record) =>
        !nativeOutputJobIdentityMatches(record, manifest) ||
        !validateResolvedPath(record.filename).isValid
    )
  )
    return null
  return task.settingsSnapshot.archiveFormat !== "none"
    ? archiveRequestedPath(tracked)
    : looseRequestedPath(tracked)
}

function hasDispatchedChapter(chapter: SourceChapter): boolean {
  return (
    (chapter.status !== "queued" && chapter.status !== "skipped") ||
    chapter.dispatchAttempt !== undefined ||
    chapter.nativeOutputSettlement !== undefined ||
    (chapter.outputs?.requested ?? 0) > 0
  )
}

function recoverChapterPath(
  task: SourceTask,
  chapter: SourceChapter,
  native: SourceNativeState,
  lease: SourceLease
): string | null {
  const dated = /<(?:YYYY|MM|DD)>/.test(
    task.settingsSnapshot.pathTemplate + task.settingsSnapshot.fileNameTemplate
  )
  if (dated && hasDispatchedChapter(chapter))
    return recordedRequestedPath(task, chapter, native, lease)
  try {
    return captureRequestedOutputPath(task, chapter)
  } catch {
    return null
  }
}

type CapturedChapter = SourceChapter & { requestedPath: string | null }

function failUnrecoverableChapter(
  chapter: CapturedChapter,
  message: string
): CapturedChapter {
  if (chapter.status !== "queued" && chapter.status !== "downloading")
    return chapter
  return {
    ...chapter,
    status:
      (chapter.outputs?.committed ?? 0) > 0 ? "partial_success" : "failed",
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
    errorMessage: message,
    errorCategory: "folder_unavailable",
  }
}

function unrecoverableTaskFailure(
  chapters: CapturedChapter[],
  message: string
) {
  const firstFailure = chapters.find(
    (chapter) =>
      chapter.status === "failed" || chapter.status === "partial_success"
  )
  return {
    errorMessage: firstFailure?.errorMessage ?? message,
    errorCategory: firstFailure?.errorCategory ?? "folder_unavailable",
  }
}

function unrecoverableTaskResult(chapters: CapturedChapter[], message: string) {
  const anySaved = chapters.some(
    (chapter) =>
      chapter.status === "completed" || (chapter.outputs?.committed ?? 0) > 0
  )
  return {
    status: anySaved ? "partial_success" : "failed",
    activeBlock: undefined,
    destinationIssue: undefined,
    destinationResume: undefined,
    nextChapterDispatchAt: undefined,
    completed: Date.now(),
    ...unrecoverableTaskFailure(chapters, message),
  }
}

function originalTaskDestination(
  override: SourceTask["destinationOverride"],
  requested: SourceTask["settingsSnapshot"]["destination"]
) {
  return override === "downloads-api" || requested === "downloads-api"
    ? { kind: "downloads-api" as const }
    : { kind: "file-system-access" as const, handleId: null }
}

function convertTask(
  task: SourceTask,
  native: SourceNativeState,
  lease: SourceLease
) {
  const { destinationOverride, ...original } = task
  const destination = originalTaskDestination(
    destinationOverride,
    task.settingsSnapshot.destination
  )
  const captured = task.chapters.map((chapter) => ({
    ...chapter,
    requestedPath: recoverChapterPath(task, chapter, native, lease),
  }))
  const pathUnavailable = captured.some(
    (chapter) => chapter.requestedPath === null
  )
  const unfinished =
    (destination.kind === "file-system-access" || pathUnavailable) &&
    (task.status === "queued" || task.status === "downloading")
  const message = pathUnavailable
    ? "The original requested path cannot be recovered. Create a new task."
    : ERROR
  const chapters = unfinished
    ? captured.map((chapter) => failUnrecoverableChapter(chapter, message))
    : captured
  return DownloadTaskStateSchema.parse({
    ...original,
    chapters,
    settingsSnapshot: { ...task.settingsSnapshot, destination },
    ...(destination.kind === "downloads-api" &&
    task.activeBlock === "destination_action_required"
      ? { activeBlock: undefined, destinationIssue: undefined }
      : {}),
    ...(unfinished ? unrecoverableTaskResult(chapters, message) : {}),
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
