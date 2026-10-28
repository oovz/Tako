import {
  resolveDownloadDirectory,
  resolveFileName,
} from "@/src/shared/template-resolver"
import type { TaskSettingsSnapshot } from "@/src/types/state-snapshots"

type PathTask = {
  created: number
  siteIntegrationId: string
  seriesTitle: string
  settingsSnapshot: Pick<
    TaskSettingsSnapshot,
    "archiveFormat" | "pathTemplate" | "fileNameTemplate" | "comicInfo"
  >
}
type PathChapter = {
  title: string
  chapterNumber?: number
  volumeNumber?: number
}

export function captureRequestedOutputPath(
  task: PathTask,
  chapter: PathChapter
): string {
  const settings = task.settingsSnapshot
  const context = {
    date: new Date(task.created),
    publisher: settings.comicInfo?.publisher,
    integrationName: task.siteIntegrationId,
    seriesTitle: task.seriesTitle,
    chapterTitle: chapter.title,
    chapterNumber: chapter.chapterNumber,
    volumeNumber: chapter.volumeNumber,
    format: settings.archiveFormat,
  }
  const directory = resolveDownloadDirectory(settings.pathTemplate, context)
  if (!directory.success || !directory.resolvedPath)
    throw new Error(
      `Directory template resolution failed: ${directory.error || "no path"}`
    )
  const filename = resolveFileName(settings.fileNameTemplate, context)
  if (!filename.success || !filename.resolvedName)
    throw new Error(
      `Filename template resolution failed: ${filename.error || "no filename"}`
    )
  const base = `${directory.resolvedPath}/${filename.resolvedName}`
  return settings.archiveFormat === "none"
    ? base
    : `${base}.${settings.archiveFormat}`
}
