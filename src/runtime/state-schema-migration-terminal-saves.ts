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

type SourceChapter = SourceTask["chapters"][number]
type DestinationIssue = SourceTask["destinationIssue"]

const FOLDER_ERROR_CATEGORIES = new Map<
  string,
  "folder_permission_required" | "disk_full" | "folder_write_failed"
>([
  ["fsa_permission_required", "folder_permission_required"],
  ["disk_full", "disk_full"],
  ["fsa_write_failed", "folder_write_failed"],
])

function folderErrorCategory(task: SourceTask, issue: DestinationIssue) {
  return (
    task.errorCategory ??
    FOLDER_ERROR_CATEGORIES.get(issue?.kind ?? "") ??
    "folder_unavailable"
  )
}

function pendingFolderChapter(task: SourceTask, issue: DestinationIssue) {
  return (
    task.chapters.find(
      (chapter) =>
        chapter.id === issue?.chapterId &&
        (chapter.status === "queued" || chapter.status === "downloading")
    ) ??
    task.chapters.find((chapter) => chapter.status === "downloading") ??
    task.chapters.find((chapter) => chapter.status === "queued")
  )
}

function settleFolderChapter(
  chapter: SourceChapter,
  pendingId: string | undefined,
  now: number,
  message: string,
  category: ReturnType<typeof folderErrorCategory>
): SourceChapter {
  if (chapter.id === pendingId)
    return {
      ...chapter,
      status:
        (chapter.outputs?.committed ?? 0) > 0 ? "partial_success" : "failed",
      errorMessage: message,
      errorCategory: category,
      lastUpdated: Math.max(chapter.lastUpdated, now),
    }
  if (chapter.status === "queued")
    return {
      ...chapter,
      status: "skipped",
      lastUpdated: Math.max(chapter.lastUpdated, now),
    }
  return chapter
}

function folderTaskStatus(chapters: SourceChapter[]) {
  if (
    chapters.length > 0 &&
    chapters.every((chapter) => chapter.status === "completed")
  )
    return "completed"
  const saved = chapters.some(
    (chapter) =>
      chapter.status === "completed" || (chapter.outputs?.committed ?? 0) > 0
  )
  return saved ? "partial_success" : "failed"
}

function folderTaskFailure(
  chapters: SourceChapter[],
  status: ReturnType<typeof folderTaskStatus>,
  message: string,
  category: ReturnType<typeof folderErrorCategory>
) {
  if (status === "completed")
    return { errorMessage: undefined, errorCategory: undefined }
  const failure = chapters.find(
    (chapter) =>
      chapter.status === "failed" || chapter.status === "partial_success"
  )
  return {
    errorMessage: failure?.errorMessage ?? message,
    errorCategory: failure?.errorCategory ?? category,
  }
}

function convertTask(source: SourceTask) {
  const task = { ...source }
  const issue = task.destinationIssue
  delete task.destinationIssue
  delete task.destinationBlockRevision
  delete task.destinationResume
  const blocked = task.activeBlock === "destination_action_required"
  const activeBlock = blocked ? undefined : task.activeBlock
  if (!blocked) return DownloadTaskStateSchema.parse({ ...task, activeBlock })
  const category = folderErrorCategory(task, issue)
  const message =
    task.errorMessage ?? "The task's selected folder is unavailable."
  const pending = pendingFolderChapter(task, issue)
  const now = issue?.occurredAt ?? task.started ?? task.created
  const chapters = task.chapters.map((chapter) =>
    settleFolderChapter(chapter, pending?.id, now, message, category)
  )
  const status = folderTaskStatus(chapters)
  return DownloadTaskStateSchema.parse({
    ...task,
    chapters,
    status,
    activeBlock,
    ...folderTaskFailure(chapters, status, message, category),
    completed: Math.max(now, ...chapters.map((chapter) => chapter.lastUpdated)),
    nextChapterDispatchAt: undefined,
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
