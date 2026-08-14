import type { Chapter } from "./chapter"
import type { SeriesMetadata } from "./series-metadata"
import type { TaskSettingsSnapshot } from "./state-snapshots"
import type { VolumeState } from "./tab-state"
import type { MangadexPreferencesPayload } from "./runtime-command-messages"

export type SeriesChapterListResult =
  | Chapter[]
  | { chapters: Chapter[]; volumes?: VolumeState[]; truncated?: boolean }

/**
 * HTML-only fallback input for integrations that cannot resolve image URLs
 * directly from structured APIs or request context.
 *
 * `chapterId` remains the canonical identity key even when HTML parsing is used.
 */
export interface ParseImageUrlsFromHtmlInput {
  chapterId: string
  chapterUrl: string
  chapterHtml: string
}

/**
 * Input for a unified background resolver that can derive series data from a
 * series page URL (and optional pre-extracted seriesId) without requiring a
 * resident content script.
 */
export interface SeriesDataResolutionInput {
  seriesUrl: string
  seriesId?: string
  language?: string
  mangadexPreferences?: MangadexPreferencesPayload
  /**
   * Validated data collected by a constrained one-shot page probe. The owning
   * integration is responsible for decoding this opaque record.
   */
  integrationContext?: Record<string, unknown>
  signal?: AbortSignal
  /**
   * Optional callback for partial results. Called when metadata is available
   * but the chapter list is still being fetched.
   */
  onPartial?: (partial: SeriesDataResolutionResult) => void | Promise<void>
}

/**
 * Result shape returned by a unified background resolver.
 * Mirrors the wire format used by FETCH_SERIES_DATA so the same normalization
 * logic can be shared between provider resolvers.
 */
export interface SeriesDataResolutionResult {
  /** Stable provider series identifier used for task/history grouping. */
  seriesId?: string
  seriesMetadata?: SeriesMetadata
  chapterList?: unknown
  metadataError?: string
  chapterListError?: string
  chapterListNotice?: "adult-consent-required"
  /** When true, metadata is available but the chapter list is still loading. */
  chaptersLoading?: boolean
}

export interface ServiceWorkerIntegration {
  name: string
  series?: {
    /**
     * Legacy granular loaders. Required unless `resolveSeriesData` is provided.
     */
    fetchSeriesMetadata?(
      seriesId: string,
      language?: string,
      signal?: AbortSignal
    ): Promise<SeriesMetadata>
    fetchChapterList?(
      seriesId: string,
      language?: string,
      signal?: AbortSignal
    ): Promise<SeriesChapterListResult>
    /**
     * Unified URL-based resolver. Preferred when an integration can resolve
     * series metadata and chapter list from the series page URL alone.
     */
    resolveSeriesData?(
      input: SeriesDataResolutionInput
    ): Promise<SeriesDataResolutionResult>
  }
  prepareDispatchContext?: (input: {
    taskId: string
    seriesKey: string
    chapter: Chapter
    settingsSnapshot: TaskSettingsSnapshot
  }) => Promise<Record<string, unknown> | undefined>
}

export interface ChapterImageIntegration {
  chapter: {
    /**
     * Canonical image-resolution path.
     *
     * Integrations should prefer this hook whenever they can fetch or derive
     * image URLs without first materializing full chapter HTML.
     */
    resolveImageUrls?: (
      chapter: { id: string; url: string },
      context?: Record<string, unknown>,
      settings?: Partial<TaskSettingsSnapshot>
    ) => Promise<string[]>
    /**
     * Optional HTML fallback path used only when `resolveImageUrls` is not
     * implemented. The provided `chapterHtml` is already decoded from bytes using
     * the response's declared charset metadata.
     */
    parseImageUrlsFromHtml?: (
      input: ParseImageUrlsFromHtmlInput
    ) => Promise<string[]>
    processImageUrls(urls: string[], chapterInfo: Chapter): Promise<string[]>
    downloadImage(
      imageUrl: string,
      opts?: {
        signal?: AbortSignal
        context?: Record<string, unknown>
        onBytesReceived?: (bytesReceived: number) => void | Promise<void>
      }
    ): Promise<{
      data: ArrayBuffer
      filename: string
      mimeType: string
    }>
  }
}

export type BackgroundIntegration = ServiceWorkerIntegration &
  ChapterImageIntegration

export interface OffscreenIntegration extends ChapterImageIntegration {
  name: string
  /**
   * Optional DOM-based series resolution used by the offscreen document.
   * The background fetches the series page HTML and sends it here for parsing.
   */
  series?: {
    resolveSeriesData(input: {
      seriesUrl: string
      html: string
      document: Document
      language?: string
    }): Promise<SeriesDataResolutionResult>
  }
}

export interface BackgroundSiteAdapter {
  id: string
  background: ServiceWorkerIntegration
}

export interface OffscreenSiteAdapter {
  id: string
  offscreen: OffscreenIntegration
}

export type RuntimeSiteIntegration = {
  id: string
  background?: ServiceWorkerIntegration
  offscreen?: OffscreenIntegration
}
