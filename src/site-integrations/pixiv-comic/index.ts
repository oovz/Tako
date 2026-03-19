import type { Chapter } from '../../types/chapter';
import type { SiteIntegration, ContentScriptIntegration, BackgroundIntegration, ParseImageUrlsFromHtmlInput } from '../../types/site-integrations';
import logger from '@/src/runtime/logger';
import { rateLimitedFetchByUrlScope } from '@/src/runtime/rate-limit';
import { decodeHtmlResponse } from '@/src/shared/html-response-decoder';
import { IntegrationContextValidator } from '../../types/site-integrations';
import { normalizeNumericText, parseChapterNumber, sanitizeLabel } from '@/src/shared/site-integration-utils';
import { descramblePixivImage } from './descrambler';

const PIXIV_BASE_URL = 'https://comic.pixiv.net';
const PIXIV_EPISODES_API_URL = `${PIXIV_BASE_URL}/api/app/episodes`;
const PIXIV_IMAGE_REFERRER = `${PIXIV_BASE_URL}/`;
const PIXIV_KEY_FRAGMENT_PARAM = 'tmdPixivKey';
const PIXIV_GRIDSHUFFLE_HEADER = 'x-cobalt-thumber-parameter-gridshuffle-key';

// Build IDs rotate on deploy. Keep a per-task cache so multi-chapter downloads
// avoid homepage fetches, while still allowing stale-build recovery per task.
const pixivBuildIdCacheByTask = new Map<string, string>();

type PixivResolveContext = {
  taskId?: string;
  cookieHeader?: string;
};

const resolvePixivCookieHeader = (context?: Record<string, unknown>): string | undefined => {
  const cookieHeader = context?.cookieHeader;
  if (typeof cookieHeader !== 'string') {
    return undefined;
  }

  const normalized = cookieHeader.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const createPixivAppHeaders = (): Record<string, string> => ({
  'x-requested-with': 'pixivcomic',
  'x-referer': PIXIV_BASE_URL,
});

const sanitizePixivHtmlText = (value: string | undefined): string | undefined => {
  const normalized = sanitizeLabel(
    (value || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
  return normalized || undefined;
};

async function fetchPixivWorkV5(workId: string): Promise<NonNullable<NonNullable<PixivWorkV5Response['data']>['official_work']>> {
  const endpoint = `${PIXIV_BASE_URL}/api/app/works/v5/${workId}`;
  const response = await rateLimitedFetchByUrlScope(endpoint, 'chapter', {
    credentials: 'include',
    headers: createPixivAppHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Pixiv Comic works/v5 failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as PixivWorkV5Response;
  const officialWork = payload.data?.official_work;
  if (!officialWork?.name) {
    throw new Error('Pixiv Comic API may have changed (official_work missing)');
  }

  return officialWork;
}

async function fetchPixivEpisodesV2(workId: string, order: 'asc' | 'desc' = 'asc'): Promise<NonNullable<NonNullable<PixivEpisodesV2Response['data']>['episodes']>> {
  const endpoint = `${PIXIV_BASE_URL}/api/app/works/${workId}/episodes/v2?order=${order}`;
  const response = await rateLimitedFetchByUrlScope(endpoint, 'chapter', {
    credentials: 'include',
    headers: createPixivAppHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Pixiv Comic episodes/v2 failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as PixivEpisodesV2Response;
  return payload.data?.episodes ?? [];
}

function mapPixivEpisodeToChapter(entry: NonNullable<NonNullable<PixivEpisodesV2Response['data']>['episodes']>[number]): Chapter | null {
  const episode = entry.episode;
  if (!episode || typeof episode.id !== 'number') {
    return null;
  }

  const id = String(episode.id);
  const viewerPath = episode.viewer_path || `/viewer/stories/${id}`;
  const url = new URL(viewerPath, PIXIV_BASE_URL).toString();

  const numberingTitle = sanitizeLabel(episode.numbering_title || '');
  const subtitle = sanitizeLabel(episode.sub_title || '');
  const chapterTitle = sanitizeLabel([numberingTitle, subtitle].filter((part) => part.length > 0).join(' ')) || `Chapter ${id}`;
  const chapterNumber = parseChapterNumber(chapterTitle);
  const { volumeLabel, volumeNumber } = parsePixivVolumeInfo(chapterTitle);

  const state = sanitizeLabel(entry.state || episode.state || '').toLowerCase();
  const locked = state.length > 0 ? state !== 'readable' : false;

  return {
    id,
    url,
    title: chapterTitle,
    locked,
    chapterLabel: numberingTitle || undefined,
    chapterNumber,
    volumeLabel,
    volumeNumber,
    comicInfo: { Title: chapterTitle },
  };
}

type PixivReadV4Page = {
  src?: string;
  url?: string;
  image_url?: string;
  key?: string;
};

type PixivWorkV5Response = {
  data?: {
    official_work?: {
      id?: number;
      name?: string;
      author?: string;
      description?: string;
      image?: {
        main?: string;
        main_big?: string;
        thumbnail?: string;
      };
    };
  };
};

type PixivEpisodesV2Response = {
  data?: {
    episodes?: Array<{
      state?: string;
      episode?: {
        id?: number;
        numbering_title?: string;
        sub_title?: string;
        read_start_at?: number;
        viewer_path?: string;
        sales_type?: string;
        state?: string;
      };
    }>;
  };
};

const toHex = (bytes: Uint8Array): string => bytes.reduce((acc, value) => acc + value.toString(16).padStart(2, '0'), '');

const encodeBase64Url = (value: string): string => {
  if (typeof btoa === 'function') {
    return btoa(value);
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf8').toString('base64');
  }

  return value;
};

const decodeBase64Url = (value: string): string => {
  if (!value) return '';

  if (typeof atob === 'function') {
    return atob(value);
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'base64').toString('utf8');
  }

  return value;
};

const withChapterToken = (sourceUrl: string, key?: string): string => {
  if (!key) {
    return sourceUrl;
  }

  // Keep source URL query string byte-for-byte intact. Pixiv CDN image URLs can
  // contain signed key-only params (e.g. ?20230208180812) that become invalid if
  // normalized to ?20230208180812= via URL serialization.
  const separator = sourceUrl.includes('#') ? '&' : '#';
  return `${sourceUrl}${separator}${PIXIV_KEY_FRAGMENT_PARAM}=${encodeURIComponent(encodeBase64Url(key))}`;
};

const extractPixivKey = (imageUrl: string): string | undefined => {
  const hashIndex = imageUrl.indexOf('#');
  if (hashIndex === -1) {
    return undefined;
  }

  const hash = imageUrl.slice(hashIndex + 1);
  const params = new URLSearchParams(hash);
  const encoded = params.get(PIXIV_KEY_FRAGMENT_PARAM);
  if (!encoded) {
    return undefined;
  }

  return decodeBase64Url(encoded);
};

const stripPixivTransportMetadata = (imageUrl: string): string => {
  const hashIndex = imageUrl.indexOf('#');
  return hashIndex === -1 ? imageUrl : imageUrl.slice(0, hashIndex);
};

const parseBuildId = (homepageHtml: string): string => {
  const buildMatch = homepageHtml.match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/);
  if (!buildMatch?.[1]) {
    throw new Error('Pixiv Comic API may have changed (build ID missing)');
  }
  return buildMatch[1];
};

const createPixivHeaders = (timestamp: string, salt: string, cookieHeader?: string): HeadersInit => {
  void salt;
  const headers: Record<string, string> = {
    'x-referer': PIXIV_BASE_URL,
    'x-requested-with': 'pixivcomic',
    'x-client-time': timestamp,
    'x-client-hash': '',
  };

  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }

  return headers;
};

const computeClientHash = async (timestamp: string, salt: string): Promise<string> => {
  const payload = `${timestamp}${salt}`;
  if (!globalThis.crypto?.subtle) {
    return payload;
  }

  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return toHex(new Uint8Array(digest));
};

const parseStoryId = (chapter: { id: string; url: string }): string => {
  if (chapter.id && /^\d+$/.test(chapter.id)) {
    return chapter.id;
  }

  const parsedFromUrl = parseEpisodeIdFromUrl(chapter.url);
  if (parsedFromUrl) {
    return parsedFromUrl;
  }

  throw new Error(`Unable to resolve Pixiv Comic story id from chapter: ${chapter.url}`);
};

async function fetchPixivBuildId(cookieHeader?: string): Promise<string> {
  logger.debug('[pixiv-comic] Fetching homepage to resolve Next.js build ID', {
    hasCookieHeader: Boolean(cookieHeader),
  });
  const response = await rateLimitedFetchByUrlScope(`${PIXIV_BASE_URL}/`, 'chapter', {
    credentials: 'include',
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Pixiv homepage: HTTP ${response.status}`);
  }

  const { html } = await decodeHtmlResponse(response);
  const buildId = parseBuildId(html);
  logger.debug('[pixiv-comic] Resolved Next.js build ID from homepage', { buildId });
  return buildId;
}

async function fetchPixivSalt(
  storyId: string,
  buildId: string,
  cookieHeader?: string,
): Promise<{ salt: string; pages: PixivReadV4Page[] }> {
  const saltUrl = `${PIXIV_BASE_URL}/_next/data/${buildId}/viewer/stories/${storyId}.json?id=${storyId}`;
  const response = await rateLimitedFetchByUrlScope(saltUrl, 'chapter', {
    credentials: 'include',
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${response.statusText}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  const payload = (await response.json()) as {
    pageProps?: {
      salt?: string;
      story?: {
        reading_episode?: {
          pages?: PixivReadV4Page[];
        };
      };
    };
  };

  const salt = payload.pageProps?.salt;
  const pages = payload.pageProps?.story?.reading_episode?.pages ?? [];

  if (!salt) {
    throw new Error('Pixiv Comic API may have changed (salt not found)');
  }

  return { salt, pages };
}

async function resolvePixivReadPages(
  chapter: { id: string; url: string },
  context?: PixivResolveContext,
): Promise<PixivReadV4Page[]> {
  const storyId = parseStoryId(chapter);
  const taskId = context?.taskId;

  let buildId = taskId ? pixivBuildIdCacheByTask.get(taskId) : undefined;
  logger.debug('[pixiv-comic] Resolving read pages', {
    chapterId: chapter.id,
    storyId,
    taskId,
    buildIdCacheHit: Boolean(buildId),
  });
  if (!buildId) {
    buildId = await fetchPixivBuildId(context?.cookieHeader);
    if (taskId) {
      pixivBuildIdCacheByTask.set(taskId, buildId);
    }
  }

  let saltResult: { salt: string; pages: PixivReadV4Page[] };
  try {
    saltResult = await fetchPixivSalt(storyId, buildId, context?.cookieHeader);
  } catch (error) {
    const statusCode = (error as { status?: number })?.status;
    if (statusCode !== 404) {
      throw error;
    }

    // Pixiv returns 404 for stale Next.js build IDs. Refresh once and retry to
    // tolerate deploy races without masking unrelated errors.

    logger.debug('[pixiv-comic] Build ID likely stale after salt fetch 404, refreshing build ID', {
      chapterId: chapter.id,
      storyId,
      previousBuildId: buildId,
    });

    const refreshedBuildId = await fetchPixivBuildId(context?.cookieHeader);
    if (taskId) {
      pixivBuildIdCacheByTask.set(taskId, refreshedBuildId);
    }

    try {
      saltResult = await fetchPixivSalt(storyId, refreshedBuildId, context?.cookieHeader);
    } catch {
      throw new Error('Pixiv Comic API may have changed (build ID stale)');
    }
  }

  // Pixiv read_v4 expects second-precision ISO time (no milliseconds).
  // This format is part of the x-client-hash payload contract.
  const timestamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const clientHash = await computeClientHash(timestamp, saltResult.salt);
  const headers = createPixivHeaders(timestamp, saltResult.salt, context?.cookieHeader) as Record<string, string>;
  headers['x-client-hash'] = clientHash;

  const response = await rateLimitedFetchByUrlScope(`${PIXIV_EPISODES_API_URL}/${storyId}/read_v4`, 'chapter', {
    credentials: 'include',
    headers,
  });

  if (!response.ok) {
    throw new Error(`Pixiv Comic read_v4 failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    pages?: PixivReadV4Page[];
    reading_episode?: {
      pages?: PixivReadV4Page[];
    };
    data?: {
      pages?: PixivReadV4Page[];
      reading_episode?: {
        pages?: PixivReadV4Page[];
      };
    };
  };

  const pages = payload.pages
    ?? payload.reading_episode?.pages
    ?? payload.data?.pages
    ?? payload.data?.reading_episode?.pages
    ?? saltResult.pages;
  logger.debug('[pixiv-comic] Resolved read pages from Pixiv API', {
    chapterId: chapter.id,
    storyId,
    pageCount: pages.length,
  });
  return pages;
}

function parseWorkId(pathname: string): string | null {
  const match = pathname.match(/^\/works\/(\d+)/);
  return match ? match[1] : null;
}

function resolveWorkIdFromDocument(): string | null {
  const metadataCandidates = [
    document.querySelector('meta[property="og:url"]')?.getAttribute('content'),
    document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
  ];

  for (const candidate of metadataCandidates) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate, window.location.origin);
      const workId = parseWorkId(parsed.pathname);
      if (workId) {
        return workId;
      }
    } catch {
      // Ignore malformed metadata URLs and continue fallback checks.
    }
  }

  const workLink = document.querySelector<HTMLAnchorElement>('a[href*="/works/"]')?.getAttribute('href');
  if (!workLink) {
    return null;
  }

  try {
    const parsed = new URL(workLink, window.location.origin);
    return parseWorkId(parsed.pathname);
  } catch {
    return null;
  }
}

function parseEpisodeIdFromUrl(chapterUrl: string): string | null {
  const url = new URL(chapterUrl);
  const storyMatch = url.pathname.match(/\/viewer\/stories\/(\d+)/);
  if (storyMatch) return storyMatch[1];

  const episodeMatch = url.pathname.match(/\/episodes\/(\d+)/);
  if (episodeMatch) return episodeMatch[1];

  return null;
}

function isPixivWorkPageReady(): boolean {
  const pathWorkId = parseWorkId(window.location.pathname);
  const metadataWorkId = resolveWorkIdFromDocument();
  return Boolean(pathWorkId || metadataWorkId);
}

async function waitForPixivWorkPageReady(timeoutMs = 8000): Promise<void> {
  if (isPixivWorkPageReady()) {
    return;
  }

  const mutationObserverCtor = globalThis.MutationObserver;
  if (typeof mutationObserverCtor !== 'function') {
    logger.debug('[pixiv-comic] MutationObserver unavailable while waiting for work page hydration');
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const observer = new mutationObserverCtor(() => {
      checkReady();
    });

    const observationTarget = document.documentElement ?? document.body ?? document.head;
    if (!observationTarget) {
      logger.debug('[pixiv-comic] Work page did not fully hydrate before extraction timeout');
      resolve();
      return;
    }

    const timeoutHandle = setTimeout(() => {
      finish(true);
    }, timeoutMs);

    const finish = (timedOut = false) => {
      if (settled) {
        return;
      }

      settled = true;
      observer.disconnect();

      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }

      if (timedOut) {
        logger.debug('[pixiv-comic] Work page did not fully hydrate before extraction timeout');
      }

      resolve();
    };

    const checkReady = () => {
      if (isPixivWorkPageReady()) {
        finish();
      }
    };

    observer.observe(observationTarget, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['content', 'href'],
    });

    checkReady();
  });
}

function parsePixivVolumeInfo(chapterTitle: string): { volumeLabel?: string; volumeNumber?: number } {
  const normalized = sanitizeLabel(chapterTitle);
  if (!normalized) {
    return {};
  }

  const explicitVolumeMatch = normalizeNumericText(normalized).match(/(?:vol(?:ume)?\.?\s*|第\s*)(\d+)(?:\s*巻)/i);
  if (!explicitVolumeMatch) {
    return {};
  }

  const parsed = Number(explicitVolumeMatch[1]);
  if (!Number.isFinite(parsed)) {
    return {};
  }

  return {
    volumeLabel: explicitVolumeMatch[0],
    volumeNumber: parsed,
  };
}

function resolvePixivCoverUrl(work: NonNullable<NonNullable<PixivWorkV5Response['data']>['official_work']>): string | undefined {
  return work.image?.main_big || work.image?.main || work.image?.thumbnail || undefined;
}

async function fetchPixivSeriesMetadata(seriesId: string) {
  const work = await fetchPixivWorkV5(seriesId);

  return {
    title: sanitizeLabel(work.name || '') || `Pixiv Comic ${seriesId}`,
    author: sanitizeLabel(work.author || '') || undefined,
    description: sanitizePixivHtmlText(work.description),
    coverUrl: resolvePixivCoverUrl(work),
    language: 'ja',
    readingDirection: 'rtl',
  };
}

async function fetchPixivChapterList(seriesId: string): Promise<Chapter[]> {
  const episodes = await fetchPixivEpisodesV2(seriesId, 'asc');
  const chapterById = new Map<string, Chapter>();
  const duplicateChapterIds = new Set<string>();

  for (const entry of episodes) {
    const chapter = mapPixivEpisodeToChapter(entry);
    if (!chapter) {
      continue;
    }

    const existing = chapterById.get(chapter.id);
    if (!existing) {
      chapterById.set(chapter.id, chapter);
      continue;
    }

    duplicateChapterIds.add(chapter.id);

    const existingLockedRank = existing.locked ? 1 : 0;
    const nextLockedRank = chapter.locked ? 1 : 0;
    if (nextLockedRank < existingLockedRank) {
      chapterById.set(chapter.id, chapter);
    }
  }

  if (duplicateChapterIds.size > 0) {
    logger.error('[pixiv-comic] Duplicate chapter ids detected in fetchChapterList', {
      seriesId,
      duplicateChapterIds: [...duplicateChapterIds],
    });
  }

  return Array.from(chapterById.values());
}

const pixivComicContentIntegration: ContentScriptIntegration = {
  name: 'Pixiv Comic Content',
  series: {
    waitForPageReady: waitForPixivWorkPageReady,
    getSeriesId(): string {
      IntegrationContextValidator.validateContentScriptContext();
      const workId = parseWorkId(window.location.pathname) ?? resolveWorkIdFromDocument();
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
    IntegrationContextValidator.validateBackgroundOrOffscreenContext();
    if (!chrome.cookies?.getAll) {
      return undefined;
    }

    try {
      const cookies = await chrome.cookies.getAll({ domain: '.pixiv.net' });
      if (cookies.length === 0) {
        return undefined;
      }

      return {
        cookieHeader: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
      };
    } catch (error) {
      logger.debug('[pixiv-comic] Failed to read cookies for dispatch context (non-fatal):', error);
      return undefined;
    }
  },
  chapter: {
    async resolveImageUrls(chapter, context): Promise<string[]> {
      IntegrationContextValidator.validateBackgroundOrOffscreenContext();

      const pages = await resolvePixivReadPages(chapter, context as PixivResolveContext | undefined);
      const urls = pages
        .map((page) => {
          const sourceUrl = page.url ?? page.src ?? page.image_url;
          if (!sourceUrl) {
            return null;
          }
          return withChapterToken(sourceUrl, page.key);
        })
        .filter((value): value is string => typeof value === 'string' && value.length > 0);

      if (urls.length === 0) {
        throw new Error('Pixiv Comic API may have changed (no image URLs found)');
      }

      logger.debug('[pixiv-comic] Resolved image URLs for chapter', {
        chapterId: chapter.id,
        urlCount: urls.length,
      });

      return urls;
    },

    parseImageUrlsFromHtml({ chapterHtml }: ParseImageUrlsFromHtmlInput): Promise<string[]> {
      IntegrationContextValidator.validateBackgroundOrOffscreenContext();

      // Fallback extraction for server-inlined assets.
      const imageUrls = Array.from(
        chapterHtml.matchAll(/https?:\/\/[^"'\s>]+\.(?:jpg|jpeg|png|webp)/gi),
        (match) => match[0],
      );

      if (imageUrls.length === 0) {
        logger.debug('[pixiv-comic] No image URLs found in chapter HTML fallback parser');
      }

      return Promise.resolve(imageUrls);
    },

    processImageUrls(urls: string[]): Promise<string[]> {
      IntegrationContextValidator.validateBackgroundOrOffscreenContext();
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
      IntegrationContextValidator.validateBackgroundOrOffscreenContext();
      if (opts?.signal?.aborted) {
        throw new Error('aborted');
      }

      const sourceImageUrl = stripPixivTransportMetadata(imageUrl);
      const pixivKey = extractPixivKey(imageUrl);
      const cookieHeader = resolvePixivCookieHeader(opts?.context);

      logger.debug('[pixiv-comic] Downloading chapter image', {
        sourceImageUrl,
        hasPixivKey: Boolean(pixivKey),
        hasCookieHeader: Boolean(cookieHeader),
        preservedSignedQuery: sourceImageUrl.includes('?') && !sourceImageUrl.includes('?=')
      });

      const requestHeaders: Record<string, string> = {
        referer: PIXIV_IMAGE_REFERRER,
      };

      if (pixivKey) {
        requestHeaders[PIXIV_GRIDSHUFFLE_HEADER] = pixivKey;
      }

      const response = await rateLimitedFetchByUrlScope(sourceImageUrl, 'image', {
        credentials: 'include',
        headers: requestHeaders,
        referrer: PIXIV_IMAGE_REFERRER,
        referrerPolicy: 'strict-origin-when-cross-origin',
        signal: opts?.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const rawData = await response.arrayBuffer();
      const mimeType = response.headers.get('content-type') || 'image/jpeg';
      const data = pixivKey
        ? await descramblePixivImage(rawData, mimeType, pixivKey, sourceImageUrl)
        : rawData;
      const filename = new URL(sourceImageUrl).pathname.split('/').filter(Boolean).pop() || 'image.jpg';

      logger.debug('[pixiv-comic] Downloaded chapter image', {
        filename,
        mimeType,
        byteLength: data.byteLength,
        usedDescrambler: Boolean(pixivKey),
      });

      return { data, filename, mimeType };
    },
  },
};

export const pixivComicIntegration: SiteIntegration = {
  id: 'pixiv-comic',
  content: pixivComicContentIntegration,
  background: pixivComicBackgroundIntegration,
};

