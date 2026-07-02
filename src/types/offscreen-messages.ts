import type { ErrorResponse } from '@/src/types/message-common';
import type { OffscreenDownloadChapterPayload } from '@/src/runtime/message-schemas';

export interface OffscreenStatusMessage {
  type: 'OFFSCREEN_STATUS';
}

export interface OffscreenStatusResponse {
  success: boolean;
  isInitialized: boolean;
  ready?: boolean;
  activeJobCount: number;
}

export interface OffscreenDownloadProgressMessage {
  type: 'OFFSCREEN_DOWNLOAD_PROGRESS';
  payload: {
    taskId: string;
    chapterId: string;
    status: 'downloading' | 'completed' | 'failed' | 'partial_success';
    chapterTitle?: string;
    error?: string;
    errorCategory?: 'network' | 'download' | 'other';
    imagesProcessed?: number;
    imagesFailed?: number;
    totalImages?: number;
    fsaFallbackTriggered?: boolean;
  };
}

export type OffscreenDownloadProgressResponse = { success: true } | ErrorResponse;

/**
 * Message type for OFFSCREEN_DOWNLOAD_CHAPTER.
 *
 * The `payload` field uses the Zod-inferred `OffscreenDownloadChapterPayload`
 * type (from `message-schemas.ts`) as the single source of truth. This keeps
 * the runtime-validated wire format and the static type aligned — no
 * `as unknown as` casts needed at the validation boundary.
 *
 * `settingsSnapshot` and `book.metadata` are `Record<string, unknown>` on the
 * wire; downstream code narrows them to `TaskSettingsSnapshot` /
 * `SeriesMetadataSnapshot` via dedicated helpers.
 */
export interface OffscreenDownloadChapterMessage {
  type: 'OFFSCREEN_DOWNLOAD_CHAPTER';
  payload: OffscreenDownloadChapterPayload;
}

export type OffscreenDownloadChapterResponse = ({
  success: true;
  status: 'completed' | 'partial_success' | 'failed';
  errorMessage?: string;
  errorCategory?: 'network' | 'download' | 'other';
  imagesFailed?: number;
}) | ErrorResponse;

export interface OffscreenDownloadApiRequestMessage {
  type: 'OFFSCREEN_DOWNLOAD_API_REQUEST';
  payload: {
    taskId: string;
    chapterId: string;
    fileUrl: string;
    filename: string;
  };
}

export type OffscreenDownloadApiRequestResponse = ({ success: true; id: number }) | ErrorResponse;

export interface RevokeBlobUrlMessage {
  type: 'REVOKE_BLOB_URL';
  payload: {
    blobUrl: string;
  };
}

export type RevokeBlobUrlResponse = { success: true } | ErrorResponse;

export interface OffscreenControlMessage {
  type: 'OFFSCREEN_CONTROL';
  payload: {
    taskId: string;
    action: 'cancel';
  };
}
