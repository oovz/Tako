import type { Chapter } from './chapter';
import type { SeriesMetadata } from './series-metadata';
import type { TaskSettingsSnapshot } from './state-snapshots';
import type { VolumeState } from './tab-state';

export type SeriesChapterListResult = Chapter[] | { chapters: Chapter[]; volumes?: VolumeState[] };

/**
 * HTML-only fallback input for integrations that cannot resolve image URLs
 * directly from structured APIs or request context.
 *
 * `chapterId` remains the canonical identity key even when HTML parsing is used.
 */
export interface ParseImageUrlsFromHtmlInput {
  chapterId: string;
  chapterUrl: string;
  chapterHtml: string;
}

export interface ContentScriptIntegration {
  name: string;
  series: {
    waitForPageReady?: () => Promise<void>;
    getSeriesId(): string;
    extractChapterList?(): SeriesChapterListResult | Promise<SeriesChapterListResult>;
    extractSeriesMetadata?(): SeriesMetadata | Promise<SeriesMetadata>;
  };
}

export interface BackgroundIntegration {
  name: string;
  series?: {
    fetchSeriesMetadata(seriesId: string, language?: string): Promise<SeriesMetadata>;
    fetchChapterList(seriesId: string, language?: string): Promise<SeriesChapterListResult>;
  };
  prepareDispatchContext?: (input: {
    taskId: string;
    seriesKey: string;
    chapter: Chapter;
    settingsSnapshot: TaskSettingsSnapshot;
  }) => Promise<Record<string, unknown> | undefined>;
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
      settings?: Record<string, unknown>
    ) => Promise<string[]>;
    /**
     * Optional HTML fallback path used only when `resolveImageUrls` is not
     * implemented. The provided `chapterHtml` is already decoded from bytes using
     * the response's declared charset metadata.
     */
    parseImageUrlsFromHtml?: (input: ParseImageUrlsFromHtmlInput) => Promise<string[]>;
    processImageUrls(urls: string[], chapterInfo: Chapter): Promise<string[]>;
    downloadImage(imageUrl: string, opts?: { signal?: AbortSignal; context?: Record<string, unknown> }): Promise<{
      data: ArrayBuffer;
      filename: string;
      mimeType: string;
    }>;
  };
}

export interface SiteIntegration {
  id: string;
  content: ContentScriptIntegration;
  background: BackgroundIntegration;
}

/**
 * Context validator to ensure functions run in correct environment
 */
export class IntegrationContextValidator {
  static validateContentScriptContext(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      throw new Error('This function must run in content script context with DOM access');
    }
  }

  static validateBackgroundOrOffscreenContext(): void {
    // Allow both background scripts (no window) and offscreen documents (window + chrome.runtime)
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      throw new Error('This function requires Chrome runtime API access');
    }

    // If window exists, we might be in offscreen context - that's OK
    // If no window, we're in background script context - that's also OK
    // Only reject if we have neither chrome.runtime access
  }
}
