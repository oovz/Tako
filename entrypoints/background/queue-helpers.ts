/**
 * Download Queue Helper Functions
 * 
 * Helper utilities for download task resolution and validation.
 * Used by download-queue.ts for plan generation and path validation.
 */

import logger from '@/src/runtime/logger';
import { validateDownloadPath } from '@/src/shared/download-path-validator';
import { resolveDownloadDirectory, resolveFileName, type TemplateContext } from '@/src/shared/template-resolver';
import type { Book } from '@/src/types/book';
import type { Chapter, ChapterInput } from '@/src/types/chapter';
import type { DownloadTaskState } from '@/src/types/queue-state';
import { buildSeriesComicInfoBase, composeChapterMetadata } from '@/src/shared/chapter-metadata';

/**
 * Unified download plan resolver result
 */
export interface DownloadPlan {
  format: 'cbz' | 'zip' | 'none';
  overwriteExisting: boolean;
  book: Book;
  chapters: Chapter[]; // resolvedPath filled
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
  const isWireFormat = (value: unknown): value is 'cbz' | 'zip' | 'none' =>
    value === 'cbz' || value === 'zip' || value === 'none'

  const settingsSnapshot = task.settingsSnapshot;
  const format = isWireFormat(settingsSnapshot.archiveFormat)
    ? settingsSnapshot.archiveFormat
    : 'cbz';
  
  logger.debug(`[Format Resolution] Final format: ${format}`);

  const overwriteExisting = settingsSnapshot.overwriteExisting;

  const finalTemplate = settingsSnapshot.pathTemplate;
  if (!finalTemplate) {
    throw new Error('Missing path template in settings or site override');
  }

  const seriesMetadata = settingsSnapshot.comicInfo;
  const comicInfoBase = buildSeriesComicInfoBase(task.seriesTitle, seriesMetadata);
  const book: Book = {
    siteId: task.siteIntegrationId,
    seriesId: task.mangaId,
    seriesTitle: task.seriesTitle,
    coverUrl: task.seriesCoverUrl,
    comicInfoBase
  };

  const chapters: Chapter[] = [];
  for (const ch of task.chapters) {
    if (!ch.title) throw new Error('chapter title missing - cannot build file path');
    if (!ch.id) throw new Error('chapter id missing - cannot build file path');
    const input: ChapterInput = {
      id: ch.id,
      url: ch.url,
      title: ch.title,
      language: ch.language,
      chapterLabel: ch.chapterLabel,
      chapterNumber: ch.chapterNumber,
      volumeNumber: ch.volumeNumber,
      volumeLabel: ch.volumeLabel
    };
    const composed = composeChapterMetadata(book, input);
    // Resolve directory & final path
    const dirCtx: TemplateContext = {
      date: new Date(),
      publisher: seriesMetadata?.publisher,
      integrationName: task.siteIntegrationId,
      seriesTitle: task.seriesTitle,
      chapterTitle: composed.title,
      chapterNumber: composed.chapterNumber,
      volumeNumber: composed.volumeNumber,
      volumeTitle: undefined,
      format
    };
    const dirRes = resolveDownloadDirectory(finalTemplate, dirCtx);
    if (!dirRes.success || !dirRes.resolvedPath) {
      throw new Error(`Directory template resolution failed: ${dirRes.error || 'no path'}`);
    }
    // Determine file base via optional filename template
    const fileBase = resolveFileName(settingsSnapshot.fileNameTemplate ?? '<CHAPTER_TITLE>', dirCtx);
    if (format === 'none') {
      // When not archiving, resolvedPath is the directory where images will be stored under a subdirectory per chapter
      composed.resolvedPath = `${dirRes.resolvedPath}/${fileBase}`; // offscreen will create subfolder
    } else {
      composed.resolvedPath = `${dirRes.resolvedPath}/${fileBase}.${format}`;
    }
    chapters.push(composed);
  }
  return Promise.resolve({ format, overwriteExisting, book, chapters });
}

/**
 * Validates download path from settings before task processing
 *
 * @param taskId - Task ID for error context
 * @param settings - Settings object containing download path
 * @throws Error if download path is missing or invalid
 */
export function validateDownloadPathForTask(
  taskId: string,
  settings: { downloads?: { pathTemplate?: string } }
): void {
  try {
    const pathTemplate = settings.downloads?.pathTemplate;
    if (!pathTemplate) {
      throw new Error('Path template not set in settings');
    }
    
    const pathValidation = validateDownloadPath(pathTemplate);
    if (!pathValidation.isValid) {
      const errorMsg = `Invalid download path: ${pathValidation.error}`;
      throw new Error(errorMsg);
    }
    
    logger.debug(`Download path validated for task ${taskId}: ${pathTemplate}`);
  } catch (error) {
    logger.error(`Path validation failed for task ${taskId}:`, error);
    throw error;
  }
}

