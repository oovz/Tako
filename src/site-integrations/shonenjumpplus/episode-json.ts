import { sanitizeLabel } from '@/src/shared/site-integration-utils';

interface EpisodeJsonPage {
  type?: string;
  src?: string;
  contentStart?: string;
  contentEnd?: string;
}

interface EpisodeJsonPayload {
  readableProduct?: {
    series?: {
      title?: string;
      thumbnailUri?: string;
      id?: string;
    };
    pageStructure?: {
      pages?: EpisodeJsonPage[];
    };
  };
}

export interface EpisodeJsonSeriesMetadata {
  seriesTitle?: string;
  seriesThumbnailUri?: string;
}

function decodeHtmlAttributeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseHexSeed(seedText: string | undefined): number | undefined {
  if (!seedText || !/^[0-9a-f]+$/i.test(seedText)) {
    return undefined;
  }

  const parsed = Number.parseInt(seedText, 16);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed >>> 0;
}

function mapEpisodeJsonPagesToImageUrls(
  pages: EpisodeJsonPage[],
  opts?: { applySeedToken?: boolean; withSeedToken?: (url: string, seed: number) => string },
): string[] {
  const pageSeed = parseHexSeed(
    pages.find((page) => typeof page.contentStart === 'string' && page.contentStart.length > 0)?.contentStart
      || pages.find((page) => typeof page.contentEnd === 'string' && page.contentEnd.length > 0)?.contentEnd,
  );

  return pages
    .filter((page) => page.type === 'main' && typeof page.src === 'string' && page.src.length > 0)
    .map((page) => {
      const sourceUrl = page.src as string;
      if (opts?.applySeedToken && typeof pageSeed === 'number' && opts.withSeedToken) {
        return opts.withSeedToken(sourceUrl, pageSeed);
      }
      return sourceUrl;
    });
}

export function readEpisodeJsonSeriesMetadataFromDocument(): EpisodeJsonSeriesMetadata {
  const episodeJsonScript = document.querySelector('script#episode-json');
  const encodedPayload = episodeJsonScript?.getAttribute('data-value');
  if (!encodedPayload) {
    return {};
  }

  try {
    const decoded = decodeHtmlAttributeEntities(encodedPayload);
    const parsed = JSON.parse(decoded) as EpisodeJsonPayload;
    const rawSeriesTitle = parsed.readableProduct?.series?.title;
    const rawSeriesThumbnailUri = parsed.readableProduct?.series?.thumbnailUri;
    const seriesTitle = typeof rawSeriesTitle === 'string' ? sanitizeLabel(rawSeriesTitle) : '';
    const seriesThumbnailUri = typeof rawSeriesThumbnailUri === 'string' ? rawSeriesThumbnailUri : '';
    return {
      seriesTitle: seriesTitle || undefined,
      seriesThumbnailUri: seriesThumbnailUri || undefined,
    };
  } catch {
    return {};
  }
}

export function extractImageUrlsFromEpisodeJsonScript(
  html: string,
  opts?: { applySeedToken?: boolean; withSeedToken?: (url: string, seed: number) => string },
): string[] {
  if (!html) {
    return [];
  }

  const scriptTagMatch = html.match(/<script[^>]*id=["']episode-json["'][^>]*\sdata-value=(["'])([\s\S]*?)\1[^>]*>/i);
  if (!scriptTagMatch) {
    return [];
  }

  const encodedPayload = scriptTagMatch[2];
  if (!encodedPayload) {
    return [];
  }

  try {
    const decodedPayload = decodeHtmlAttributeEntities(encodedPayload);
    const payload = JSON.parse(decodedPayload) as EpisodeJsonPayload;
    const pages = payload.readableProduct?.pageStructure?.pages;
    if (!Array.isArray(pages)) {
      return [];
    }
    return mapEpisodeJsonPagesToImageUrls(pages, opts);
  } catch {
    return [];
  }
}

