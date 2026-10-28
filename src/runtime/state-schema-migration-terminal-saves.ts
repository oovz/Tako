import { z } from "zod"
import { LOCAL_STORAGE_KEYS } from "./storage-keys"
import {
  DownloadTaskStateSchema as SourceTaskSchema,
  PendingUndoActionSchema as SourceUndoSchema,
} from "./state-schema-migration-final-save-schemas"
import {
  DownloadTaskStateSchema,
  PendingUndoActionSchema,
} from "./state-schema-migration-terminal-save-schemas"

type SourceTask = z.infer<typeof SourceTaskSchema>

function convertTask(source: SourceTask) {
  const task = { ...source }
  const issue = task.destinationIssue
  delete task.destinationIssue
  delete task.destinationBlockRevision
  delete task.destinationResume
  const blocked = task.activeBlock === "destination_action_required"
  const activeBlock = blocked ? undefined : task.activeBlock
  if (!blocked) return DownloadTaskStateSchema.parse({ ...task, activeBlock })
  const category =
    task.errorCategory ??
    (issue?.kind === "fsa_permission_required"
      ? "folder_permission_required"
      : issue?.kind === "disk_full"
        ? "disk_full"
        : issue?.kind === "fsa_write_failed"
          ? "folder_write_failed"
          : "folder_unavailable")
  const message =
    task.errorMessage ?? "The task's selected folder is unavailable."
  const pending =
    task.chapters.find(
      (chapter) =>
        chapter.id === issue?.chapterId &&
        (chapter.status === "queued" || chapter.status === "downloading")
    ) ??
    task.chapters.find((chapter) => chapter.status === "downloading") ??
    task.chapters.find((chapter) => chapter.status === "queued")
  const now = issue?.occurredAt ?? task.started ?? task.created
  const chapters = task.chapters.map((chapter) =>
    chapter.id === pending?.id
      ? {
          ...chapter,
          status:
            (chapter.outputs?.committed ?? 0) > 0
              ? "partial_success"
              : "failed",
          errorMessage: message,
          errorCategory: category,
          lastUpdated: Math.max(chapter.lastUpdated, now),
        }
      : chapter.status === "queued"
        ? {
            ...chapter,
            status: "skipped",
            lastUpdated: Math.max(chapter.lastUpdated, now),
          }
        : chapter
  )
  const failure = chapters.find(
    (chapter) =>
      chapter.status === "failed" || chapter.status === "partial_success"
  )
  const completed =
    chapters.length > 0 &&
    chapters.every((chapter) => chapter.status === "completed")
  const saved = chapters.some(
    (chapter) =>
      chapter.status === "completed" || (chapter.outputs?.committed ?? 0) > 0
  )
  return DownloadTaskStateSchema.parse({
    ...task,
    chapters,
    activeBlock,
    status: completed ? "completed" : saved ? "partial_success" : "failed",
    completed: Math.max(now, ...chapters.map((chapter) => chapter.lastUpdated)),
    nextChapterDispatchAt: undefined,
    errorMessage: completed ? undefined : (failure?.errorMessage ?? message),
    errorCategory: completed ? undefined : (failure?.errorCategory ?? category),
  })
}

/** Convert former folder-action blocks into terminal results with retained output. */
export function buildTerminalSaveWrites(
  stored: Record<string, unknown>
): Record<string, unknown> {
  const queue = z
    .array(SourceTaskSchema)
    .parse(
      stored[LOCAL_STORAGE_KEYS.downloadQueue] === undefined
        ? []
        : stored[LOCAL_STORAGE_KEYS.downloadQueue]
    )
  const undo = z
    .array(SourceUndoSchema)
    .parse(
      stored[LOCAL_STORAGE_KEYS.pendingUndoActions] === undefined
        ? []
        : stored[LOCAL_STORAGE_KEYS.pendingUndoActions]
    )
  return {
    [LOCAL_STORAGE_KEYS.downloadQueue]: queue.map(convertTask),
    [LOCAL_STORAGE_KEYS.pendingUndoActions]: undo.map((action) =>
      PendingUndoActionSchema.parse({
        ...action,
        taskSnapshot: convertTask(action.taskSnapshot),
      })
    ),
  }
}
