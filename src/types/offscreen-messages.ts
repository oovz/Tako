import type { ErrorResponse } from '@/src/types/message-common';
import type { SeriesMetadataSnapshot, TaskSettingsSnapshot } from '@/src/types/state-snapshots';

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

export interface OffscreenDownloadChapterMessage {
  type: 'OFFSCREEN_DOWNLOAD_CHAPTER';
  payload: {
    taskId: string;
    seriesKey: string;
    book: {
      siteIntegrationId: string;
      seriesTitle: string;
      coverUrl?: string;
      metadata?: SeriesMetadataSnapshot;
    };
    chapter: {
      id: string;
      title: string;
      url: string;
      index: number;
      chapterLabel?: string;
      chapterNumber?: number;
      volumeNumber?: number;
      volumeLabel?: string;
      language?: string;
      resolvedPath: string;
    };
    settingsSnapshot: TaskSettingsSnapshot;
    saveMode: 'fsa' | 'downloads-api';
    integrationContext?: Record<string, unknown>;
  };
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
