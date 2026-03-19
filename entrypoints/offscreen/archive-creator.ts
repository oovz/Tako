/**
 * Archive Creator - ZIP/CBZ Archive Generation
 * 
 * Handles archive creation workflow using Web Workers for compression.
 * Supports both browser downloads and File System Access API.
 */

import { generateComicInfo } from '@/src/shared/comicinfo-generator';
import type { ComicInfoV2 } from '@/src/types/comic-info';
import { sanitizeFilename } from '@/src/shared/filename-sanitizer';
import { loadDownloadRootHandle, verifyPermission, writeBlobToPath } from '@/src/storage/fs-access';
import logger from '@/src/runtime/logger';
import {
  OffscreenDownloadApiRequestMessage,
  OffscreenDownloadApiRequestResponse,
} from '@/src/types/offscreen-messages';
import ZipWorker from './zip.worker.ts?worker';

/**
 * Archive request from download workflow
 */
export interface ArchiveRequest {
  taskId: string;
  chapterId: string;
  chapterTitle: string;
  images: Array<{ filename: string; data: number[] }>;
  coverImage?: { data: number[]; extension: string }; // Cover image
  volumeLabel?: string;
  metadata?: ComicInfoV2;
  format: 'zip' | 'cbz';
  comicInfoVersion?: '2.0';
  resolvedPath: string; // Background-resolved final path including filename + extension
  downloadMode?: 'browser' | 'custom';
}

/**
 * Archive creation result
 */
export interface ArchiveResult {
  success: true;
  filename: string;
  size: number;
  imageCount: number;
  format: string;
}

/**
 * Web Worker result type
 */
type WorkerZipResult = {
  success: boolean;
  buffer: ArrayBuffer;
  filename: string;
  size: number;
  imageCount: number;
  format: string;
  error?: string;
};

/**
 * Creates ZIP/CBZ archive using Web Worker
 */
export async function createArchive(
  request: ArchiveRequest,
  progressCallback: (progress: number, message?: string) => void
): Promise<ArchiveResult> {
  const { chapterTitle, images, coverImage, metadata, format, comicInfoVersion = '2.0' } = request;

  logger.debug(`📦 Creating ${format.toUpperCase()} archive (streaming): ${chapterTitle}`);
  logger.debug(`📊 Processing ${images.length} images`);
  if (coverImage) {
    logger.debug(`🖼️ Including cover image (${coverImage.extension})`);
  }
  progressCallback(10, `Creating ${format.toUpperCase()} archive...`);

  // Generate ComicInfo XML if metadata provided
  // Pass hasCoverImage flag to mark cover in metadata
  let comicInfoXml: string | undefined;
  if (metadata) {
    progressCallback(15, 'Generating ComicInfo.xml...');
    const totalPages = images.length + (coverImage ? 1 : 0);
    const hasCoverImage = !!coverImage;
    const xml = generateComicInfo(metadata, totalPages, comicInfoVersion, hasCoverImage);
    if (xml) comicInfoXml = xml;
  }

  // Create Web Worker for ZIP compression
  const worker = new ZipWorker();

  const workerReq = {
    chapterTitle: sanitizeFilename(chapterTitle),
    images,
    coverImage, // Include cover for worker to add as first file
    comicInfoXml,
    extension: format
  };

  // Execute compression in worker with timeout
  const result = await new Promise<WorkerZipResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      try {
        worker.terminate();
      } catch {
        /* noop */
      }
      reject(new Error('Zip worker timed out'));
    }, 5 * 60 * 1000); // 5 minutes safety

    worker.onmessage = (ev: MessageEvent<WorkerZipResult>) => {
      clearTimeout(timeout);
      resolve(ev.data);
    };

    worker.onerror = (e) => {
      clearTimeout(timeout);
      const err = e.error instanceof Error
        ? e.error
        : new Error('Zip worker error', { cause: e.error ?? e });
      reject(err); // Ref: https://github.com/typescript-eslint/typescript-eslint/blob/main/packages/eslint-plugin/docs/rules/prefer-promise-reject-errors.mdx
    };

    worker.postMessage(workerReq);
  });

  if (!result?.success) {
    throw new Error(result?.error || 'Failed to create archive');
  }

  progressCallback(95, 'Preparing download...');

  // Convert to Blob for download
  // Use correct MIME type for CBZ to prevent Chrome from appending .zip
  const mimeType = format === 'cbz' ? 'application/x-cbz' : 'application/zip';
  const blob = new Blob([result.buffer], { type: mimeType });

  // Use background-resolved path (authoritative)
  if (!request.resolvedPath) {
    throw new Error('Missing resolvedPath from background');
  }
  const finalPath = request.resolvedPath;
  logger.debug(`[Archive Download] format=${format}, finalPath=${finalPath}`);

  // Determine download mode
  const downloadMode: 'browser' | 'custom' = request.downloadMode || 'browser';
  if (!request.downloadMode) {
    throw new Error('Missing downloadMode in archive request');
  }

  // Custom folder mode: File System Access API
  if (downloadMode === 'custom') {
    try {
      const dir = await loadDownloadRootHandle();
      if (dir && (await verifyPermission(dir, true))) {
        await writeBlobToPath(dir, finalPath, blob, true);
        logger.debug(`📁 Wrote file via FS Access (custom mode): ${finalPath}, overwrite: true`);
        return {
          success: true,
          filename: result.filename,
          size: result.size,
          imageCount: result.imageCount,
          format: result.format
        };
      } else {
        logger.warn('⚠️ Custom folder mode selected but no valid permission/handle available, falling back to browser downloads');
      }
    } catch (fsErr) {
      const msg = (fsErr && typeof fsErr === 'object' && 'message' in fsErr) ? (fsErr as Error).message : 'Unknown error';
      logger.warn('⚠️ Custom folder mode failed, falling back to browser downloads:', msg);
    }
  }

  // Browser downloads mode (default) or fallback
  await downloadViaBrowser(request, blob, finalPath);

  progressCallback(100, 'Archive created!');

  return {
    success: true,
    filename: result.filename,
    size: result.size,
    imageCount: result.imageCount,
    format: result.format
  };
}

/**
 * Download archive via browser chrome.downloads API
 */
async function downloadViaBrowser(request: ArchiveRequest, blob: Blob, finalPath: string): Promise<void> {
  const normalizePath = (p: string) => {
    let s = p.replace(/\\/g, '/').replace(/^[/.]+/, '');
    s = s.split('/').filter(Boolean).join('/');
    return s;
  };
  const normalized = normalizePath(finalPath);

  if (!request.taskId || !request.chapterId) {
    throw new Error('Missing explicit archive download context');
  }

  const fileUrl = URL.createObjectURL(blob);
  const resp = await chrome.runtime.sendMessage<OffscreenDownloadApiRequestMessage, OffscreenDownloadApiRequestResponse>({
    type: 'OFFSCREEN_DOWNLOAD_API_REQUEST',
    payload: {
      taskId: request.taskId,
      chapterId: request.chapterId,
      fileUrl,
      filename: normalized,
    }
  });

  if (!resp || resp.success !== true) {
    const errorMessage = resp && 'error' in resp ? resp.error : 'background downloads.download failed';
    throw new Error(errorMessage);
  }

  logger.debug(`📥 Background chrome.downloads started (blob URL): ${normalized}`);
}

