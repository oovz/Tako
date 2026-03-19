import type { ErrorResponse } from '@/src/types/message-common';
import type {
  AcknowledgeErrorMessage,
  AcknowledgeErrorResponse,
  ClearAllHistoryMessage,
  ClearAllHistoryResponse,
  GetSettingsMessage,
  GetSettingsResponse,
  GetTabIdMessage,
  GetTabIdResponse,
  MoveTaskToTopMessage,
  MoveTaskToTopResponse,
  OpenOptionsMessage,
  OpenOptionsResponse,
  RestartTaskMessage,
  RestartTaskResponse,
  RetryFailedChaptersMessage,
  RetryFailedChaptersResponse,
  StartDownloadMessage,
  StartDownloadResponse,
  SyncSettingsToStateMessage,
  SyncSettingsToStateResponse,
} from '@/src/types/runtime-command-messages';
import type {
  OffscreenControlMessage,
  OffscreenDownloadApiRequestMessage,
  OffscreenDownloadApiRequestResponse,
  OffscreenDownloadChapterMessage,
  OffscreenDownloadChapterResponse,
  OffscreenDownloadProgressMessage,
  OffscreenDownloadProgressResponse,
  OffscreenStatusMessage,
  OffscreenStatusResponse,
  RevokeBlobUrlMessage,
  RevokeBlobUrlResponse,
} from '@/src/types/offscreen-messages';
import type { StateActionMessage, StateActionResponse } from '@/src/types/state-action-message';

export type ExtensionMessage =
  | GetTabIdMessage
  | GetSettingsMessage
  | SyncSettingsToStateMessage
  | AcknowledgeErrorMessage
  | OffscreenStatusMessage
  | OffscreenControlMessage
  | OffscreenDownloadChapterMessage
  | OffscreenDownloadProgressMessage
  | OffscreenDownloadApiRequestMessage
  | RevokeBlobUrlMessage
  | RetryFailedChaptersMessage
  | RestartTaskMessage
  | MoveTaskToTopMessage
  | ClearAllHistoryMessage
  | OpenOptionsMessage
  | StartDownloadMessage
  | StateActionMessage;

export type ExtensionMessageResponse =
  | GetTabIdResponse
  | GetSettingsResponse
  | SyncSettingsToStateResponse
  | AcknowledgeErrorResponse
  | OffscreenStatusResponse
  | OffscreenDownloadChapterResponse
  | OffscreenDownloadProgressResponse
  | OffscreenDownloadApiRequestResponse
  | RevokeBlobUrlResponse
  | RetryFailedChaptersResponse
  | RestartTaskResponse
  | MoveTaskToTopResponse
  | ClearAllHistoryResponse
  | OpenOptionsResponse
  | StartDownloadResponse
  | StateActionResponse
  | ErrorResponse;
