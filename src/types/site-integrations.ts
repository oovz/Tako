import type { Chapter } from "./chapter"
import type { SeriesMetadata } from "./series-metadata"
import type { TaskSettingsSnapshot } from "./state-snapshots"
import type { RateScopePolicy } from "./rate-policy"
import type { ChapterImagePlan } from "@/src/site-integrations/chapter-plan"
import type {
  OffscreenLiveResourceLedger,
  OffscreenLiveResourceLease,
} from "@/src/runtime/offscreen-live-resource-ledger"
import type { VolumeState } from "./tab-state"
import type { JsonValue } from "@/src/shared/type-guards"
import type { RateLimitService } from "@/src/runtime/rate-limit"

/** JSON-safe object carried across the background/offscreen boundary. */
export type JsonObject = { [key: string]: JsonValue }

/** Narrow background-owned reader for provider-defined durable settings. */
export interface SiteIntegrationSettingsReader {
  getAll(): Promise<Record<string, Record<string, unknown>>>
  getForSite(siteIntegrationId: string): Promise<Record<string, unknown>>
}

export type SeriesChapterListResult =
  | Chapter[]
  | { chapters: Chapter[]; volumes?: VolumeState[]; truncated?: boolean }

/**
 * Input for a unified background resolver that can derive series data from a
 * series page URL (and optional pre-extracted seriesId) without requiring a
 * resident content script.
 */
export interface SeriesDataResolutionInput {
  seriesUrl: string
  seriesId?: string
  language?: string
  /**
   * Opaque data collected by the owning integration's constrained one-shot
   * page probe. The provider adapter is responsible for decoding it.
   */
  pageProbeData?: unknown
  signal?: AbortSignal
  rateLimitService: RateLimitService
  siteIntegrationSettingsReader: SiteIntegrationSettingsReader
  /**
   * Optional callback for partial results. Called when metadata is available
   * but the chapter list is still being fetched.
   */
  onPartial?: (partial: SeriesDataResolutionResult) => void | Promise<void>
}

/**
 * Result shape returned by a unified background resolver.
 * Shared by provider resolvers and series-data normalization.
 */
export interface SeriesDataResolutionResult {
  /** Stable provider series identifier used for task/history grouping. */
  seriesId?: string
  seriesMetadata?: SeriesMetadata
  chapterList?: SeriesChapterListResult
  metadataError?: string
  chapterListError?: string
  chapterListNotice?: "adult-consent-required"
  /** When true, metadata is available but the chapter list is still loading. */
  chaptersLoading?: boolean
}

export interface ServiceWorkerIntegration<
  DispatchContext extends JsonObject = JsonObject,
> {
  name: string
  /** Optional provider-owned policy for whether a page probe may run. */
  shouldExecutePageProbe?: (input: {
    siteIntegrationSettingsReader: SiteIntegrationSettingsReader
  }) => Promise<boolean>
  /** Optional provider-owned persistence of successful page-probe data. */
  persistPageProbeData?: (input: {
    seriesId: string
    pageProbeData: unknown
  }) => Promise<void>
  series?: {
    /** Canonical provider-owned series metadata/chapter resolver. */
    resolveSeriesData(
      input: SeriesDataResolutionInput
    ): Promise<SeriesDataResolutionResult>
  }
  prepareDispatchContext?: (input: {
    taskId: string
    seriesKey: string
    chapter: Chapter
    settingsSnapshot: TaskSettingsSnapshot
    siteIntegrationSettingsReader: SiteIntegrationSettingsReader
  }) => Promise<DispatchContext | undefined>
}

export interface ChapterRuntimeData {
  chapterId?: string
  rateLimitService: RateLimitService
  rateLimitSettings: {
    image: RateScopePolicy
    chapter: RateScopePolicy
  }
}

export interface ChapterImageIntegration<
  DispatchContext extends JsonObject = JsonObject,
> {
  chapter: {
    resolveChapterPlan(
      chapter: { id: string; url: string },
      input: {
        dispatchContext?: DispatchContext
        runtime: ChapterRuntimeData
        settings?: Partial<TaskSettingsSnapshot>
        signal?: AbortSignal
      }
    ): Promise<ChapterImagePlan>
    downloadImage(
      this: void,
      imageUrl: string,
      opts: {
        signal?: AbortSignal
        dispatchContext?: DispatchContext
        runtime: ChapterRuntimeData
        skipRateLimit?: boolean
        onBytesReceived?: (bytesReceived: number) => void | Promise<void>
        liveResourceLedger?: OffscreenLiveResourceLedger
      }
    ): Promise<{
      data: ArrayBuffer
      filename: string
      mimeType: string
      liveResourceLease?: OffscreenLiveResourceLease
    }>
  }
}

export interface CoverImageIntegration<
  DispatchContext extends JsonObject = JsonObject,
> {
  downloadImage(
    this: void,
    imageUrl: string,
    opts: {
      signal?: AbortSignal
      dispatchContext?: DispatchContext
      runtime: ChapterRuntimeData
      skipRateLimit?: boolean
      onBytesReceived?: (bytesReceived: number) => void | Promise<void>
      liveResourceLedger?: OffscreenLiveResourceLedger
    }
  ): Promise<{
    data: ArrayBuffer
    filename: string
    mimeType: string
    liveResourceLease?: OffscreenLiveResourceLease
  }>
}

export interface OffscreenIntegration<
  DispatchContext extends JsonObject = JsonObject,
> extends ChapterImageIntegration<DispatchContext> {
  name: string
  /** Provider-specific cover policy; chapter reconstruction is not reused. */
  cover?: CoverImageIntegration<DispatchContext>
  /**
   * Optional DOM-based series resolution used by the offscreen document.
   * The background fetches the series page HTML and sends it here for parsing.
   */
  series?: {
    resolveSeriesData(input: {
      requestId: string
      seriesUrl: string
      html: string
      document: Document
      language?: string
      signal?: AbortSignal
      rateLimitService: RateLimitService
    }): Promise<SeriesDataResolutionResult>
  }
  dispatchContext?: {
    parse(value: JsonObject): DispatchContext
  }
}

export interface BackgroundSiteAdapter<
  DispatchContext extends JsonObject = JsonObject,
> {
  id: string
  background: ServiceWorkerIntegration<DispatchContext>
}

export interface OffscreenSiteAdapter<
  DispatchContext extends JsonObject = JsonObject,
> {
  id: string
  offscreen: OffscreenIntegration<DispatchContext>
}
