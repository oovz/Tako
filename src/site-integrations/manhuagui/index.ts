import type { Chapter } from '@/src/types/chapter';
import type { SeriesMetadata } from '@/src/types/series-metadata';
import type {
  BackgroundIntegration,
  ContentScriptIntegration,
  SiteIntegration,
} from '@/src/types/site-integrations';
import {
  downloadManhuaguiChapterImage,
  parseManhuaguiImageUrlsFromHtml,
  processManhuaguiImageUrls,
  resolveManhuaguiChapterImageUrls,
} from './chapter-api';
import { prepareManhuaguiDispatchContext } from './dispatch-context';
import { extractChaptersFromDocument, extractSeriesMetadataFromDocument } from './series-dom';
import { parseSeriesIdFromPath } from './shared';

/**
 * Content-script half of the Manhuagui integration. All methods operate on
 * the live series page DOM — background chapter-viewer operations live in
 * `chapter-api.ts` / `chapter-viewer.ts`. Methods return synchronously so
 * callers can compare to the other integrations (`pixiv-comic`,
 * `shonenjumpplus`, `mangadex`) without awaiting.
 */
const manhuaguiContentIntegration: ContentScriptIntegration = {
  name: 'Manhuagui Content',
  series: {
    getSeriesId(): string {
      const seriesId = parseSeriesIdFromPath(window.location.pathname);
      if (!seriesId) {
        throw new Error(`Failed to extract series ID from URL: ${window.location.pathname}`);
      }
      return seriesId;
    },

    extractSeriesMetadata(): SeriesMetadata {
      return extractSeriesMetadataFromDocument(document);
    },

    extractChapterList(): Chapter[] {
      return extractChaptersFromDocument(document);
    },
  },
};

/**
 * Background half of the Manhuagui integration. Methods are thin wrappers
 * around `chapter-api.ts` so message handlers and offscreen fallbacks share a
 * single implementation.
 */
const manhuaguiBackgroundIntegration: BackgroundIntegration = {
  name: 'Manhuagui Background',
  prepareDispatchContext: prepareManhuaguiDispatchContext,
  chapter: {
    resolveImageUrls(chapter): Promise<string[]> {
      return resolveManhuaguiChapterImageUrls(chapter);
    },

    parseImageUrlsFromHtml(input) {
      return parseManhuaguiImageUrlsFromHtml(input);
    },

    processImageUrls(urls: string[]): Promise<string[]> {
      return processManhuaguiImageUrls(urls);
    },

    downloadImage(imageUrl: string, opts?: { signal?: AbortSignal; context?: Record<string, unknown> }) {
      return downloadManhuaguiChapterImage(imageUrl, opts);
    },
  },
};

export const manhuaguiIntegration: SiteIntegration = {
  id: 'manhuagui',
  content: manhuaguiContentIntegration,
  background: manhuaguiBackgroundIntegration,
};
