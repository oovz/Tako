import type { Chapter } from '../../types/chapter';
import type { SiteIntegration, ContentScriptIntegration, BackgroundIntegration, ParseImageUrlsFromHtmlInput } from '../../types/site-integrations';
import logger from '@/src/runtime/logger';
import { rateLimitedFetchByUrlScope } from '@/src/runtime/rate-limit';
import { decodeHtmlResponse } from '@/src/shared/html-response-decoder';
import { parseChapterNumber, sanitizeLabel } from '@/src/shared/site-integration-utils';
import {
  extractImageUrlsFromEpisodeJsonScript,
  readEpisodeJsonSeriesMetadataFromDocument,
} from './episode-json';

const encodeSeed = (seed: number): string => {
  const seedText = String(seed);
  if (typeof btoa === 'function') {
    return btoa(seedText);
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(seedText, 'utf8').toString('base64');
  }

  return seedText;
};

// Persist scramble seed in the URL so the queue can pass one opaque image token
// through storage/messages without introducing site-specific image metadata types.
const withSeedToken = (url: string, seed: number): string => {
  const parsed = new URL(url);
  parsed.searchParams.set('sjpSeed', encodeSeed(seed));
  return parsed.toString();
};

const decodeSeed = (encoded: string): number | undefined => {
  try {
    const decoded = typeof atob === 'function'
      ? atob(encoded)
      : typeof Buffer !== 'undefined'
        ? Buffer.from(encoded, 'base64').toString('utf8')
        : encoded;

    const value = Number(decoded);
    if (!Number.isFinite(value)) {
      return undefined;
    }
    return value >>> 0;
  } catch {
    return undefined;
  }
};

// Remove internal sjpSeed token before the network request; CDN URLs must remain
// byte-for-byte valid and only the downloader needs this seed for descrambling.
const parseSeedFromImageUrl = (imageUrl: string): { sourceUrl: string; seed?: number } => {
  const parsed = new URL(imageUrl);
  const encodedSeed = parsed.searchParams.get('sjpSeed');
  parsed.searchParams.delete('sjpSeed');

  return {
    sourceUrl: parsed.toString(),
    seed: encodedSeed ? decodeSeed(encodedSeed) : undefined,
  };
};

const buildGigaviewerPermutation = (): Array<{ source: { x: number; y: number }; dest: { x: number; y: number } }> => {
  const permutation: Array<{ source: { x: number; y: number }; dest: { x: number; y: number } }> = [];

  for (let index = 0; index < 16; index += 1) {
    const sourceX = index % 4;
    const sourceY = Math.floor(index / 4);

    // Matches the live Shonen Jump+ viewer implementation in chunk 202:
    // dest index = sourceX * 4 + sourceY (4x4 tile transposition).
    permutation.push({
      source: { x: sourceX, y: sourceY },
      dest: { x: sourceY, y: sourceX },
    });
  }

  return permutation;
};

const isShonenJumpPlusPageImageUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'cdn-ak-img.shonenjumpplus.com' && parsed.pathname.includes('/public/page/');
  } catch {
    return false;
  }
};

const normalizeMimeType = (mimeType: string): string => {
  if (mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp') {
    return mimeType;
  }
  return 'image/png';
};

const GIGAVIEWER_DIVIDE_NUM = 4;
const GIGAVIEWER_MULTIPLE = 8;

const descrambleGigaviewerImage = async (buffer: ArrayBuffer, mimeType: string): Promise<ArrayBuffer> => {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    return buffer;
  }

  const blob = new Blob([buffer], { type: mimeType });
  const bitmap = await createImageBitmap(blob);

  try {
    const tileWidth = Math.floor(bitmap.width / (GIGAVIEWER_DIVIDE_NUM * GIGAVIEWER_MULTIPLE)) * GIGAVIEWER_MULTIPLE;
    const tileHeight = Math.floor(bitmap.height / (GIGAVIEWER_DIVIDE_NUM * GIGAVIEWER_MULTIPLE)) * GIGAVIEWER_MULTIPLE;
    if (tileWidth <= 0 || tileHeight <= 0) {
      return buffer;
    }

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) {
      return buffer;
    }

    context.imageSmoothingEnabled = false;
    // Keep non-tiled edge regions exactly as the original viewer does.
    context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, bitmap.width, bitmap.height);

    const permutation = buildGigaviewerPermutation();
    for (const tile of permutation) {
      context.drawImage(
        bitmap,
        tile.source.x * tileWidth,
        tile.source.y * tileHeight,
        tileWidth,
        tileHeight,
        tile.dest.x * tileWidth,
        tile.dest.y * tileHeight,
        tileWidth,
        tileHeight,
      );
    }

    const finalMimeType = normalizeMimeType(mimeType);
    const outputBlob = await canvas.convertToBlob({
      type: finalMimeType,
      quality: finalMimeType === 'image/jpeg' ? 0.92 : undefined,
    });
    return await outputBlob.arrayBuffer();
  } finally {
    bitmap.close();
  }
};

function parseEpisodeId(pathname: string): string | null {
  const match = pathname.match(/^\/episode\/(\d+)/);
  return match ? match[1] : null;
}

type ReadableProductPaginationInfoResponse = {
  per_page?: number;
  readable_products_count?: number;
};

type ReadableProductStatus = {
  label?: string;
  rental_price?: number | null;
  buy_price?: number | null;
};

type PaginationReadableProduct = {
  readable_product_id?: string;
  viewer_uri?: string;
  title?: string;
  status?: ReadableProductStatus;
};

const SHONEN_JUMP_PLUS_PAGINATION_BASE_URL = 'https://shonenjumpplus.com/api/viewer';

function getSeriesAggregateIdFromDom(): string | null {
  const aggregateId = document
    .querySelector('.js-readable-products-pagination')
    ?.getAttribute('data-aggregate-id');

  return aggregateId && /^\d+$/.test(aggregateId)
    ? aggregateId
    : null;
}

function mapPaginationReadableProductToChapter(product: PaginationReadableProduct): Chapter | null {
  const readableProductId = typeof product.readable_product_id === 'string'
    ? product.readable_product_id
    : '';
  if (!/^\d+$/.test(readableProductId)) {
    return null;
  }

  const viewerUri = typeof product.viewer_uri === 'string'
    ? product.viewer_uri
    : '';

  let chapterUrl: string;
  try {
    chapterUrl = new URL(viewerUri || `/episode/${readableProductId}`, window.location.origin).href;
  } catch {
    return null;
  }

  const chapterEpisodeId = parseEpisodeId(new URL(chapterUrl).pathname);
  if (!chapterEpisodeId) {
    return null;
  }

  const chapterTitle = sanitizeLabel(product.title || '') || `Episode ${chapterEpisodeId}`;
  const chapterNumber = parseChapterNumber(chapterTitle);

  const statusLabel = sanitizeLabel(product.status?.label || '').toLowerCase();
  const hasPrice = typeof product.status?.rental_price === 'number' || typeof product.status?.buy_price === 'number';
  const locked = statusLabel.includes('free')
    ? false
    : statusLabel.length > 0
      ? true
      : hasPrice;

  return {
    id: chapterEpisodeId,
    url: chapterUrl,
    title: chapterTitle,
    locked,
    chapterLabel: chapterTitle,
    chapterNumber,
    comicInfo: { Title: chapterTitle, LanguageISO: 'ja', Manga: 'YesAndRightToLeft' },
  };
}

async function fetchReadableProductPaginationInfo(aggregateId: string, episodeId: string): Promise<ReadableProductPaginationInfoResponse> {
  const endpoint = new URL(`${SHONEN_JUMP_PLUS_PAGINATION_BASE_URL}/readable_product_pagination_information`);
  endpoint.searchParams.set('type', 'episode');
  endpoint.searchParams.set('aggregate_id', aggregateId);
  endpoint.searchParams.set('readable_product_id', episodeId);

  const response = await fetch(endpoint.toString(), { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Shonen Jump+ pagination info request failed: HTTP ${response.status}`);
  }

  return (await response.json()) as ReadableProductPaginationInfoResponse;
}

async function fetchPaginationReadableProducts(aggregateId: string, offset: number, limit: number): Promise<PaginationReadableProduct[]> {
  const endpoint = new URL(`${SHONEN_JUMP_PLUS_PAGINATION_BASE_URL}/pagination_readable_products`);
  endpoint.searchParams.set('type', 'episode');
  endpoint.searchParams.set('aggregate_id', aggregateId);
  endpoint.searchParams.set('offset', String(offset));
  endpoint.searchParams.set('limit', String(limit));
  endpoint.searchParams.set('sort_order', 'desc');
  endpoint.searchParams.set('is_guest', '1');

  const response = await fetch(endpoint.toString(), { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Shonen Jump+ chapter pagination request failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  return Array.isArray(payload) ? payload as PaginationReadableProduct[] : [];
}

function readTextBySelectors(selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const text = sanitizeLabel(document.querySelector(selector)?.textContent || '');
    if (text) {
      return text;
    }
  }
  return undefined;
}

const shonenJumpPlusContentIntegration: ContentScriptIntegration = {
  name: 'Shonen Jump+ Content',
  series: {
    getSeriesId(): string {
      const episodeId = parseEpisodeId(window.location.pathname);
      if (!episodeId) {
        throw new Error(`Failed to extract series ID from URL: ${window.location.pathname}`);
      }
      return episodeId;
    },

    async extractChapterList(): Promise<Chapter[]> {
      const aggregateId = getSeriesAggregateIdFromDom();
      const episodeId = parseEpisodeId(window.location.pathname);
      if (!aggregateId || !episodeId) {
        throw new Error('Shonen Jump+ episode pagination context not found in DOM');
      }

      const paginationInfo = await fetchReadableProductPaginationInfo(aggregateId, episodeId);
      const limit = typeof paginationInfo.per_page === 'number' && paginationInfo.per_page > 0
        ? paginationInfo.per_page
        : 50;
      const totalCount = typeof paginationInfo.readable_products_count === 'number' && paginationInfo.readable_products_count > 0
        ? paginationInfo.readable_products_count
        : limit;

      const chapterById = new Map<string, Chapter>();
      const duplicateChapterIds = new Set<string>();

      for (let offset = 0; offset < totalCount; offset += limit) {
        const products = await fetchPaginationReadableProducts(aggregateId, offset, limit);
        for (const product of products) {
          const chapter = mapPaginationReadableProductToChapter(product);
          if (!chapter) {
            continue;
          }

          if (chapterById.has(chapter.id)) {
            duplicateChapterIds.add(chapter.id);
            continue;
          }

          chapterById.set(chapter.id, chapter);
        }

        if (products.length < limit) {
          break;
        }
      }

      if (duplicateChapterIds.size > 0) {
        logger.error('[shonenjumpplus] Duplicate chapter ids detected in fetchChapterList', {
          aggregateId,
          duplicateChapterIds: [...duplicateChapterIds],
        });
      }

      return Array.from(chapterById.values());
    },

    extractSeriesMetadata() {
      const jsonMetadata = readEpisodeJsonSeriesMetadataFromDocument();
      const domTitle = readTextBySelectors([
        '.series-header-title',
        '#series-header-title',
      ]);
      const title = jsonMetadata.seriesTitle
        || domTitle;

      if (!title) {
        throw new Error('Series title not found in page metadata');
      }

      const author = readTextBySelectors([
        '.series-header-author',
        '#series-header-author',
      ]);

      const description = readTextBySelectors([
        '.series-header-description',
        '#series-header-description',
      ]) || sanitizeLabel(
        document.querySelector('meta[property="og:description"]')?.getAttribute('content') || ''
      ) || undefined;

      const coverUrl = jsonMetadata.seriesThumbnailUri
        || document.querySelector('meta[property="og:image"]')?.getAttribute('content')
        || undefined;

      return {
        title,
        author,
        description,
        coverUrl,
        language: 'ja',
        readingDirection: 'rtl',
      };
    },
  },
};

const shonenJumpPlusBackgroundIntegration: BackgroundIntegration = {
  name: 'Shonen Jump+ Background',
  chapter: {
    async resolveImageUrls(chapter): Promise<string[]> {
      const episodeId = parseEpisodeId(new URL(chapter.url).pathname);
      if (!episodeId) {
        throw new Error(`Invalid Shonen Jump+ chapter URL: ${chapter.url}`);
      }

      const chapterResponse = await rateLimitedFetchByUrlScope(chapter.url, 'chapter');
      if (!chapterResponse.ok) {
        throw new Error(`HTTP ${chapterResponse.status}: ${chapterResponse.statusText}`);
      }

      const { html: chapterHtml } = await decodeHtmlResponse(chapterResponse);
      const htmlUrls = extractImageUrlsFromEpisodeJsonScript(chapterHtml, { applySeedToken: true, withSeedToken });
      logger.debug('[shonenjumpplus] Resolved image URLs via episode-json script', {
        chapterId: chapter.id,
        episodeId,
        urlCount: htmlUrls.length,
      });

      if (htmlUrls.length === 0) {
        logger.warn('[shonenjumpplus] episode-json script missing or empty in chapter HTML', { episodeId, chapterUrl: chapter.url });
      }

      return htmlUrls;
    },

    parseImageUrlsFromHtml({ chapterHtml, chapterUrl }: ParseImageUrlsFromHtmlInput): Promise<string[]> {
      const episodeId = parseEpisodeId(new URL(chapterUrl).pathname);
      if (!episodeId) {
        throw new Error(`Invalid Shonen Jump+ chapter URL: ${chapterUrl}`);
      }

      const structuredUrls = extractImageUrlsFromEpisodeJsonScript(chapterHtml, { applySeedToken: true, withSeedToken });
      if (structuredUrls.length > 0) {
        return Promise.resolve(structuredUrls);
      }

      logger.warn('[shonenjumpplus] episode-json script missing or empty while parsing image URLs from HTML', { episodeId, chapterUrl });
      return Promise.resolve([]);
    },

    processImageUrls(urls: string[]): Promise<string[]> {
      const filtered = urls.filter((url) => {
        try {
          new URL(url);
          return true;
        } catch {
          return false;
        }
      });
      return Promise.resolve(filtered);
    },

    async downloadImage(imageUrl: string, opts?: { signal?: AbortSignal; context?: Record<string, unknown> }): Promise<{ data: ArrayBuffer; filename: string; mimeType: string }> {
      if (opts?.signal?.aborted) {
        throw new Error('aborted');
      }

      const { sourceUrl, seed } = parseSeedFromImageUrl(imageUrl);

      logger.debug('[shonenjumpplus] Downloading chapter image', {
        sourceUrl,
        hasSeed: typeof seed === 'number',
      });

      const response = await rateLimitedFetchByUrlScope(sourceUrl, 'image');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const rawData = await response.arrayBuffer();
      const mimeType = response.headers.get('content-type') || 'image/jpeg';
      const shouldDescramble = typeof seed === 'number' || isShonenJumpPlusPageImageUrl(sourceUrl);
      const data = shouldDescramble
        ? await descrambleGigaviewerImage(rawData, mimeType)
        : rawData;
      const filename = new URL(sourceUrl).pathname.split('/').filter(Boolean).pop() || 'image.jpg';

      logger.debug('[shonenjumpplus] Downloaded chapter image', {
        filename,
        mimeType,
        byteLength: data.byteLength,
        usedDescrambler: shouldDescramble,
      });

      return { data, filename, mimeType };
    },
  },
};

export const shonenJumpPlusIntegration: SiteIntegration = {
  id: 'shonenjumpplus',
  content: shonenJumpPlusContentIntegration,
  background: shonenJumpPlusBackgroundIntegration,
};

