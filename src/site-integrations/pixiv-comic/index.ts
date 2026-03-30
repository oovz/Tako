import type { SiteIntegration, ContentScriptIntegration, BackgroundIntegration, ParseImageUrlsFromHtmlInput } from '../../types/site-integrations';
import {
  downloadPixivChapterImage,
  parsePixivImageUrlsFromHtml,
  preparePixivDispatchContext,
  processPixivImageUrls,
  resolvePixivChapterImageUrls,
} from './chapter-api';
import { resolvePixivWorkIdFromPage, waitForPixivWorkPageReady } from './page-context';
import { fetchPixivChapterList, fetchPixivSeriesMetadata } from './series-api';

const pixivComicContentIntegration: ContentScriptIntegration = {
  name: 'Pixiv Comic Content',
  series: {
    waitForPageReady: waitForPixivWorkPageReady,
    getSeriesId(): string {
      const workId = resolvePixivWorkIdFromPage();
      if (!workId) {
        throw new Error('Failed to resolve Pixiv Comic work id from page context');
      }
      return workId;
    },
  },
};

const pixivComicBackgroundIntegration: BackgroundIntegration = {
  name: 'Pixiv Comic Background',
  series: {
    fetchSeriesMetadata: fetchPixivSeriesMetadata,
    fetchChapterList: fetchPixivChapterList,
  },
  prepareDispatchContext: async () => {
    return preparePixivDispatchContext();
  },
  chapter: {
    async resolveImageUrls(chapter, context): Promise<string[]> {
      return resolvePixivChapterImageUrls(chapter, context as { taskId?: string; cookieHeader?: string } | undefined);
    },

    parseImageUrlsFromHtml(input: ParseImageUrlsFromHtmlInput): Promise<string[]> {
      return parsePixivImageUrlsFromHtml(input);
    },

    processImageUrls(urls: string[]): Promise<string[]> {
      return processPixivImageUrls(urls);
    },

    async downloadImage(imageUrl: string, opts?: { signal?: AbortSignal; context?: Record<string, unknown> }): Promise<{ data: ArrayBuffer; filename: string; mimeType: string }> {
      return downloadPixivChapterImage(imageUrl, opts);
    },
  },
};

export const pixivComicIntegration: SiteIntegration = {
  id: 'pixiv-comic',
  content: pixivComicContentIntegration,
  background: pixivComicBackgroundIntegration,
};

