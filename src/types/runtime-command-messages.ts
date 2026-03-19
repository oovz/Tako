import type { ExtensionSettings } from '@/src/storage/settings-types';
import type { SeriesMetadataSnapshot } from '@/src/types/state-snapshots';
import type { ErrorResponse } from '@/src/types/message-common';

export interface AcknowledgeErrorMessage {
  type: 'ACKNOWLEDGE_ERROR';
  payload: {
    code: string;
  };
}

export type AcknowledgeErrorResponse = { success: true } | ErrorResponse;

export interface GetTabIdMessage {
  type: 'GET_TAB_ID';
}

export interface GetTabIdResponse {
  success: boolean;
  tabId?: number;
  error?: string;
}

export interface GetSettingsMessage {
  type: 'GET_SETTINGS';
}

export type GetSettingsResponse = ({ success: true } & ExtensionSettings) | ErrorResponse;

export interface SyncSettingsToStateMessage {
  type: 'SYNC_SETTINGS_TO_STATE';
  payload: {
    settings: ExtensionSettings;
  };
}

export type SyncSettingsToStateResponse = { success: true } | ErrorResponse;

export interface RetryFailedChaptersMessage {
  type: 'RETRY_FAILED_CHAPTERS';
  payload: {
    taskId: string;
  };
}

export type RetryFailedChaptersResponse = { success: true } | ErrorResponse;

export interface RestartTaskMessage {
  type: 'RESTART_TASK';
  payload: {
    taskId: string;
  };
}

export type RestartTaskResponse = { success: true } | ErrorResponse;

export interface MoveTaskToTopMessage {
  type: 'MOVE_TASK_TO_TOP';
  payload: {
    taskId: string;
  };
}

export type MoveTaskToTopResponse = { success: true } | ErrorResponse;

export interface ClearAllHistoryMessage {
  type: 'CLEAR_ALL_HISTORY';
  payload?: Record<string, never>;
}

export type ClearAllHistoryResponse = { success: true; removedCount?: number } | ErrorResponse;

export interface OpenOptionsMessage {
  type: 'OPEN_OPTIONS';
  payload?: {
    page?: 'global' | 'integrations' | 'downloads' | 'debug';
  };
}

export type OpenOptionsResponse = { success: true } | ErrorResponse;

export interface StartDownloadMessage {
  type: 'START_DOWNLOAD';
  payload: {
    sourceTabId?: number;
    siteIntegrationId: string;
    mangaId: string;
    seriesTitle: string;
    chapters: Array<{
      id: string;
      title: string;
      url: string;
      index: number;
      chapterLabel?: string;
      chapterNumber?: number;
      volumeLabel?: string;
      volumeNumber?: number;
      language?: string;
    }>;
    metadata?: SeriesMetadataSnapshot;
  };
}

export type StartDownloadResponse = ({ success: true; taskId: string }) | ErrorResponse;
