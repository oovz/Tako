import type { ExtensionSettings } from "@/src/storage/settings-types"
import type { SeriesMetadataSnapshot } from "@/src/types/state-snapshots"
import type { SeriesMetadata } from "@/src/types/series-metadata"
import type { ErrorResponse } from "@/src/types/message-common"
import type { CommandEnvelope } from "@/src/types/command-envelope"

export interface AcknowledgeErrorMessage extends Partial<CommandEnvelope> {
  type: "ACKNOWLEDGE_ERROR"
  payload: {
    code: string
  }
}

export type AcknowledgeErrorResponse = { success: true } | ErrorResponse

/** Request a fresh, background-owned projection for the active page tab. */
export interface RequestTabContextRefreshMessage {
  type: "REQUEST_TAB_CONTEXT_REFRESH"
  payload?: {
    tabId?: number
    windowId?: number
    reason?: "sidepanel-mount" | "manhuagui-adult-gate"
  }
}

export type RequestTabContextRefreshResponse = { success: true } | ErrorResponse

export interface GetSettingsMessage {
  type: "GET_SETTINGS"
}

export type GetSettingsResponse =
  ({ success: true } & ExtensionSettings) | ErrorResponse

export interface SyncSettingsToStateMessage extends Partial<CommandEnvelope> {
  type: "SYNC_SETTINGS_TO_STATE"
  payload: {
    settings: ExtensionSettings
  }
}

export type SyncSettingsToStateResponse = { success: true } | ErrorResponse

export interface MangadexPreferencesPayload {
  dataSaver: boolean
  filteredLanguages: string[]
  showSafe?: boolean
  showSuggestive?: boolean
  showErotic?: boolean
  showHentai?: boolean
}

export interface FetchSeriesDataMessage {
  type: "FETCH_SERIES_DATA"
  payload: {
    siteIntegrationId: string
    seriesId?: string
    seriesUrl?: string
    language?: string
    mangadexPreferences?: MangadexPreferencesPayload
  }
}

export type FetchSeriesDataResponse =
  | {
      success: true
      seriesId?: string
      seriesMetadata?: SeriesMetadata
      chapterList?: unknown
      metadataError?: string
      chapterListError?: string
    }
  | ErrorResponse

export interface RetryFailedChaptersMessage extends Partial<CommandEnvelope> {
  type: "RETRY_FAILED_CHAPTERS"
  payload: {
    taskId: string
  }
}

export type RetryFailedChaptersResponse = { success: true } | ErrorResponse

export interface RestartTaskMessage extends Partial<CommandEnvelope> {
  type: "RESTART_TASK"
  payload: {
    taskId: string
  }
}

export type RestartTaskResponse = { success: true } | ErrorResponse

export interface MoveTaskToTopMessage extends Partial<CommandEnvelope> {
  type: "MOVE_TASK_TO_TOP"
  payload: {
    taskId: string
  }
}

export type MoveTaskToTopResponse = { success: true } | ErrorResponse

export interface ClearAllHistoryMessage extends Partial<CommandEnvelope> {
  type: "CLEAR_ALL_HISTORY"
  payload?: Record<string, never>
}

export type ClearAllHistoryResponse =
  { success: true; removedCount?: number } | ErrorResponse

export interface OpenOptionsMessage {
  type: "OPEN_OPTIONS"
  payload?: {
    page?: "global" | "integrations" | "downloads" | "debug"
  }
}

export type OpenOptionsResponse = { success: true } | ErrorResponse

export interface GetSiteIntegrationEnablementMessage {
  type: "GET_SITE_INTEGRATION_ENABLEMENT"
}

export type SiteIntegrationEnablementMap = Record<string, boolean>

export type GetSiteIntegrationEnablementResponse =
  { success: true; enablement: SiteIntegrationEnablementMap } | ErrorResponse

export interface StartDownloadMessage extends Partial<CommandEnvelope> {
  type: "START_DOWNLOAD"
  payload: {
    sourceTabId?: number
    siteIntegrationId: string
    mangaId: string
    seriesTitle: string
    chapters: Array<{
      id: string
      title: string
      url: string
      index: number
      chapterLabel?: string
      chapterNumber?: number
      volumeId?: string
      volumeLabel?: string
      volumeNumber?: number
      language?: string
    }>
    metadata?: SeriesMetadataSnapshot
  }
}

export type StartDownloadResponse =
  { success: true; taskId: string } | ErrorResponse
