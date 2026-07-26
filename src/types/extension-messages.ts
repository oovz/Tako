import type { ErrorResponse } from "@/src/types/message-common"
import type {
  AcknowledgeErrorMessage,
  AcknowledgeErrorResponse,
  ClearAllHistoryMessage,
  ClearAllHistoryResponse,
  ClearPersistedDownloadHistoryMessage,
  ClearPersistedDownloadHistoryResponse,
  FetchSeriesDataMessage,
  FetchSeriesDataResponse,
  GetSettingsMessage,
  GetSettingsResponse,
  GetSiteIntegrationEnablementMessage,
  GetSiteIntegrationEnablementResponse,
  RequestTabContextRefreshMessage,
  RequestTabContextRefreshResponse,
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
} from "@/src/types/runtime-command-messages"
import type {
  OffscreenControlMessage,
  OffscreenOutputReadyMessage,
  OffscreenOutputReadyResponse,
  OffscreenDownloadChapterMessage,
  OffscreenDownloadChapterResponse,
  OffscreenDownloadProgressMessage,
  OffscreenDownloadProgressResponse,
  OffscreenParseSeriesHtmlMessage,
  OffscreenParseSeriesHtmlResponse,
  OffscreenStatusMessage,
  OffscreenStatusResponse,
  RevokeBlobUrlMessage,
  RevokeBlobUrlResponse,
  OffscreenJobAcceptedMessage,
  OffscreenJobHeartbeatMessage,
  OffscreenQueryJobMessage,
  OffscreenQueryJobResponse,
  OffscreenCancelJobMessage,
  OffscreenCancelJobResponse,
} from "@/src/types/offscreen-messages"
import type {
  StateActionMessage,
  StateActionResponse,
} from "@/src/types/state-action-message"

export type ExtensionMessage =
  | RequestTabContextRefreshMessage
  | GetSettingsMessage
  | GetSiteIntegrationEnablementMessage
  | FetchSeriesDataMessage
  | SyncSettingsToStateMessage
  | AcknowledgeErrorMessage
  | OffscreenStatusMessage
  | OffscreenControlMessage
  | OffscreenDownloadChapterMessage
  | OffscreenDownloadProgressMessage
  | OffscreenOutputReadyMessage
  | OffscreenJobAcceptedMessage
  | OffscreenJobHeartbeatMessage
  | OffscreenQueryJobMessage
  | OffscreenCancelJobMessage
  | OffscreenParseSeriesHtmlMessage
  | RevokeBlobUrlMessage
  | RetryFailedChaptersMessage
  | RestartTaskMessage
  | MoveTaskToTopMessage
  | ClearAllHistoryMessage
  | ClearPersistedDownloadHistoryMessage
  | OpenOptionsMessage
  | StartDownloadMessage
  | StateActionMessage

export type ExtensionMessageResponse =
  | RequestTabContextRefreshResponse
  | GetSettingsResponse
  | GetSiteIntegrationEnablementResponse
  | FetchSeriesDataResponse
  | SyncSettingsToStateResponse
  | AcknowledgeErrorResponse
  | OffscreenStatusResponse
  | OffscreenDownloadChapterResponse
  | OffscreenDownloadProgressResponse
  | OffscreenOutputReadyResponse
  | OffscreenQueryJobResponse
  | OffscreenCancelJobResponse
  | OffscreenParseSeriesHtmlResponse
  | RevokeBlobUrlResponse
  | RetryFailedChaptersResponse
  | RestartTaskResponse
  | MoveTaskToTopResponse
  | ClearAllHistoryResponse
  | ClearPersistedDownloadHistoryResponse
  | OpenOptionsResponse
  | StartDownloadResponse
  | StateActionResponse
  | ErrorResponse
