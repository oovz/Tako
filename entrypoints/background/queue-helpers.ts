/**
 * Download Queue Helper Functions
 *
 * Helper utilities for download task resolution and validation.
 * Used by the queue task executor and chapter dispatch coordinator.
 */

import logger from "@/src/runtime/logger"
import type { Book } from "@/src/types/book"
import type { Chapter, ChapterInput } from "@/src/types/chapter"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import {
  buildSeriesComicInfoBase,
  composeChapterMetadata,
  pickChapterArchiveMetadata,
} from "@/src/shared/chapter-metadata"

/**
 * Unified download plan resolver result
 */
export interface DownloadPlan {
  format: "cbz" | "zip" | "none"
  book: Book
  chapters: Chapter[] // resolvedPath filled
}

/**
 * Resolves complete download plan with format, overwrite settings, and chapter paths
 *
 * @param task - Download task to resolve plan for
 * @returns Resolved download plan with all paths and settings
 */
export function resolveDownloadPlan(
  task: DownloadTaskState
): Promise<DownloadPlan> {
  const settingsSnapshot = task.settingsSnapshot
  const format = settingsSnapshot.archiveFormat

  logger.debug(`[Format Resolution] Final format: ${format}`)

  const seriesMetadata = settingsSnapshot.comicInfo
  const comicInfoBase = buildSeriesComicInfoBase(
    task.seriesTitle,
    seriesMetadata
  )
  const book: Book = {
    siteId: task.siteIntegrationId,
    seriesId: task.mangaId,
    seriesTitle: task.seriesTitle,
    coverUrl: task.seriesCoverUrl,
    comicInfoBase,
  }

  const chapters: Chapter[] = []
  for (const ch of task.chapters) {
    if (!ch.title)
      throw new Error("chapter title missing - cannot build file path")
    if (!ch.id) throw new Error("chapter id missing - cannot build file path")
    const input: ChapterInput = {
      ...pickChapterArchiveMetadata(ch),
      id: ch.id,
      url: ch.url,
      title: ch.title,
      language: ch.language,
      chapterLabel: ch.chapterLabel,
      chapterNumber: ch.chapterNumber,
      volumeId: ch.volumeId,
      volumeNumber: ch.volumeNumber,
      volumeLabel: ch.volumeLabel,
    }
    const composed = composeChapterMetadata(book, input)
    if (ch.requestedPath === null)
      throw new Error(
        "The original output path is unavailable; create a new task"
      )
    composed.resolvedPath = ch.requestedPath
    chapters.push(composed)
  }
  return Promise.resolve({ format, book, chapters })
}
