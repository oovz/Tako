/**
 * MangaDex API Site Integration
 *
 * Uses official MangaDex API v5 for:
 * - Series metadata: GET /manga/{id}?includes[]=author&includes[]=cover_art
 * - Chapter list: GET /manga/{id}/feed
 * - Chapter images: GET /at-home/server/{chapterId}
 *
 * Rate limits:
 * - Global: 5 req/s/IP
 * - at-home: 40 req/min
 *
 * Required: Report image load success/failure to api.mangadex.network/report
 */

import type { Chapter } from '../../types/chapter';
import type { SeriesMetadata } from '../../types/series-metadata';
import type { SiteIntegration, ContentScriptIntegration, BackgroundIntegration, ParseImageUrlsFromHtmlInput } from '../../types/site-integrations';
import logger from '@/src/runtime/logger';
import { IntegrationContextValidator } from '../../types/site-integrations';
import { siteIntegrationSettingsService } from '@/src/storage/site-integration-settings-service';
import { composeSeriesKey } from '@/src/runtime/queue-task-summary';
import { parseConfiguredMangadexImageQuality, prepareMangadexDispatchContext } from '../mangadex-dispatch-context';
import {
  buildMangadexUploadsRecoveryImageUrl,
  buildPageUrls,
  type AtHomeResponse,
  isSameMangadexBaseUrl,
  normalizeMangadexBaseUrl,
  parseMangadexImageDeliveryTarget,
  resolveMangadexImageUrlForQuality,
} from './image-delivery';

// Ref: tests/e2e/fixtures/test-domains.ts (TMD_TEST_* overrides for mock domains)
const MANGADEX_API_BASE =
  import.meta.env.TMD_TEST_MANGADEX_API_BASE
  || 'https://api.mangadex.org';
const MANGADEX_UPLOADS_BASE =
  import.meta.env.TMD_TEST_MANGADEX_UPLOADS_BASE
  || 'https://uploads.mangadex.org';
const MANGADEX_NETWORK_REPORT =
  import.meta.env.TMD_TEST_MANGADEX_NETWORK_REPORT
  || 'https://api.mangadex.network/report';
const MANGADEX_NETWORK_REPORT_HOST = new URL(MANGADEX_NETWORK_REPORT).hostname;
const MANGADEX_NETWORK_REPORT_TIMEOUT_MS = 1500;
const MANGADEX_IMAGE_RECOVERY_MAX_CYCLES = 5;
const MANGADEX_IMAGE_RECOVERY_BACKOFF_MS = 250;
const MANGADEX_TEST_DOMAIN =
  import.meta.env.TMD_TEST_MANGADEX_DOMAIN;
const MANGADEX_SITE_BASE = MANGADEX_TEST_DOMAIN
  ? `https://${MANGADEX_TEST_DOMAIN}`
  : 'https://mangadex.org';
const MANGADEX_PREFS_SESSION_KEY = 'mangadexUserPreferencesBySeries';

/**
 * MangaDex user preferences type
 * Extracted from localStorage key 'md' on MangaDex site
 */
export interface MangadexUserPreferences {
  dataSaver: boolean; // Use data-saver quality images (default: true)
  filteredLanguages: string[];
  showSafe?: boolean;
  showSuggestive?: boolean;
  showErotic?: boolean;
  showHentai?: boolean;
}

type MangadexPreferencesBySeries = Record<string, MangadexUserPreferences>;

const isMangadexUserPreferences = (value: unknown): value is MangadexUserPreferences => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.dataSaver === 'boolean'
    && Array.isArray(record.filteredLanguages)
    && record.filteredLanguages.every((lang) => typeof lang === 'string')
    && (record.showSafe === undefined || typeof record.showSafe === 'boolean')
    && (record.showSuggestive === undefined || typeof record.showSuggestive === 'boolean')
    && (record.showErotic === undefined || typeof record.showErotic === 'boolean')
    && (record.showHentai === undefined || typeof record.showHentai === 'boolean');
};

const parseMangadexPreferencesBySeries = (value: unknown): MangadexPreferencesBySeries => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const record = value as Record<string, unknown>;
  const parsed: MangadexPreferencesBySeries = {};
  for (const [seriesKey, prefs] of Object.entries(record)) {
    if (isMangadexUserPreferences(prefs)) {
      parsed[seriesKey] = prefs;
    }
  }
  return parsed;
};

const buildMangadexSeriesKey = (seriesId: string): string => composeSeriesKey('mangadex', seriesId);

async function cacheMangadexPreferencesForSeries(seriesId: string): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) {
    return;
  }

  const prefs = readMangadexUserPreferences();
  const session = await chrome.storage.session.get(MANGADEX_PREFS_SESSION_KEY) as Record<string, unknown>;
  const bySeries = parseMangadexPreferencesBySeries(session[MANGADEX_PREFS_SESSION_KEY]);
  bySeries[buildMangadexSeriesKey(seriesId)] = prefs;
  await chrome.storage.session.set({
    [MANGADEX_PREFS_SESSION_KEY]: bySeries,
  });
}

const getContextMangadexPreferences = (context?: Record<string, unknown>): MangadexUserPreferences | undefined => {
  const prefs = context?.mangadexUserPreferences;
  return isMangadexUserPreferences(prefs) ? prefs : undefined;
};

const getContextConfiguredMangadexImageQuality = (context?: Record<string, unknown>): 'data' | 'data-saver' | undefined => {
  return parseConfiguredMangadexImageQuality(context?.mangadexConfiguredImageQuality);
};

const resolveConfiguredMangadexImageQuality = async (): Promise<'data' | 'data-saver' | undefined> => {
  try {
    const allSettings = await siteIntegrationSettingsService.getAll();
    const siteSettings = allSettings.mangadex;
    if (!siteSettings || typeof siteSettings !== 'object') {
      return undefined;
    }

    return parseConfiguredMangadexImageQuality((siteSettings as Record<string, unknown>).imageQuality);
  } catch {
    return undefined;
  }
};

async function resolveMangadexImageQuality(context?: Record<string, unknown>): Promise<'data' | 'data-saver'> {
  const configuredImageQuality = getContextConfiguredMangadexImageQuality(context)
    ?? await resolveConfiguredMangadexImageQuality();
  const contextPrefs = getContextMangadexPreferences(context);
  const cachedPrefs = getCachedMangadexPreferences();

  if (configuredImageQuality) {
    return configuredImageQuality;
  }

  const prefs = contextPrefs ?? cachedPrefs;
  return prefs.dataSaver ? 'data-saver' : 'data';
}

type MangadexStatisticsResponse = {
  statistics?: Record<string, {
    rating?: {
      average?: number;
      bayesian?: number;
    };
  }>;
};

/**
 * Read MangaDex user preferences from localStorage
 * Must be called from content script context (DOM access required)
 * Returns default preferences if localStorage is unavailable or invalid
 */
export function readMangadexUserPreferences(): MangadexUserPreferences {
  const defaults: MangadexUserPreferences = {
    dataSaver: true, // Default to data-saver for bandwidth efficiency
    filteredLanguages: [],
  };

  try {
    // Only available in content script context
    if (typeof localStorage === 'undefined') {
      logger.debug('[mangadex] localStorage not available (not in content script context)');
      return defaults;
    }

    const mdData = localStorage.getItem('md');
    if (!mdData) {
      logger.debug('[mangadex] No MangaDex preferences found in localStorage');
      return defaults;
    }

    const parsed: unknown = JSON.parse(mdData);
    const parsedRecord = (parsed && typeof parsed === 'object')
      ? (parsed as Record<string, unknown>)
      : {};

    const isRecord = (value: unknown): value is Record<string, unknown> => (
      typeof value === 'object' && value !== null
    );

    // Extract userPreferences from MangaDex localStorage structure
    // MangaDex stores preferences under various nested keys
    const userPrefs = isRecord(parsedRecord.userPreferences)
      ? parsedRecord.userPreferences
      : isRecord(parsedRecord.settings)
        ? parsedRecord.settings
        : parsedRecord;

    const dataSaverValue = userPrefs['dataSaver'];
    const filteredLanguagesValue = userPrefs['filteredLanguages'];
    const showSafeValue = userPrefs['showSafe'];
    const showSuggestiveValue = userPrefs['showSuggestive'];
    const showEroticValue = userPrefs['showErotic'];
    const showHentaiValue = userPrefs['showHentai'];

    const result: MangadexUserPreferences = {
      dataSaver: typeof dataSaverValue === 'boolean'
        ? dataSaverValue
        : defaults.dataSaver,
      filteredLanguages: Array.isArray(filteredLanguagesValue)
        ? filteredLanguagesValue.filter((l: unknown): l is string => typeof l === 'string')
        : defaults.filteredLanguages,
      showSafe: typeof showSafeValue === 'boolean' ? showSafeValue : undefined,
      showSuggestive: typeof showSuggestiveValue === 'boolean' ? showSuggestiveValue : undefined,
      showErotic: typeof showEroticValue === 'boolean' ? showEroticValue : undefined,
      showHentai: typeof showHentaiValue === 'boolean' ? showHentaiValue : undefined,
    };

    logger.debug('[mangadex] Read user preferences from localStorage:', result);
    return result;
  } catch (error) {
    logger.debug('[mangadex] Failed to parse MangaDex preferences:', error);
    return defaults;
  }
}

// Default retry configuration for MangaDex internal retry logic
const MANGADEX_RETRY_CONFIG = {
  maxRetries: 3,
  defaultRetryDelayMs: 5000, // 5 seconds default if no X-RateLimit-Retry-After
  maxRetryDelayMs: 60000, // Cap at 60 seconds
};

/**
 * Parse X-RateLimit-Retry-After header from MangaDex 429 responses
 * Returns delay in milliseconds, or null if header is missing/invalid
 * Header contains UNIX timestamp (seconds since epoch)
 */
function parseRetryAfterHeader(response: Response): number | null {
  const retryAfter = response.headers.get('X-RateLimit-Retry-After');
  if (!retryAfter) return null;

  const timestamp = parseInt(retryAfter, 10);
  if (Number.isNaN(timestamp)) return null;

  // Calculate delay from current time to retry timestamp
  const delayMs = (timestamp * 1000) - Date.now();
  
  // Ensure positive delay, capped at max
  return Math.min(
    Math.max(delayMs, 100), // At least 100ms
    MANGADEX_RETRY_CONFIG.maxRetryDelayMs
  );
}

/**
 * Internal retry wrapper for MangaDex API calls
 * Handles 429 responses with X-RateLimit-Retry-After header parsing
 */
async function fetchWithMangadexRetry(
  url: string,
  options?: RequestInit,
  retryCount = 0
): Promise<Response> {
  const response = await fetch(url, options);

  if (response.status === 429 && retryCount < MANGADEX_RETRY_CONFIG.maxRetries) {
    const retryDelay = parseRetryAfterHeader(response) ?? MANGADEX_RETRY_CONFIG.defaultRetryDelayMs;
    
    logger.warn(`[mangadex] Rate limited (429), retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${MANGADEX_RETRY_CONFIG.maxRetries})`);
    
    await new Promise(resolve => setTimeout(resolve, retryDelay));
    return fetchWithMangadexRetry(url, options, retryCount + 1);
  }

  return response;
}

function parseUuidFromPath(pathname: string, prefix: string): string | null {
  const segs = pathname.split('/').filter(Boolean);
  if (segs.length < 2) return null;
  if (segs[0] !== prefix) return null;
  const id = segs[1];
  return id && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id) ? id : null;
}

function parseChapterIdFromUrl(chapterUrl: string): string {
  const u = new URL(chapterUrl);
  const id = parseUuidFromPath(u.pathname, 'chapter');
  if (!id) {
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length >= 2 && segs[0] === 'chapter') return segs[1];
    throw new Error(`Invalid MangaDex chapter URL: ${chapterUrl}`);
  }
  return id;
}

type MangadexRelationship = {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
};

type MangadexMangaResponse = {
  result: string;
  data: {
    id: string;
    type: string;
    attributes: {
      title: Record<string, string>;
      altTitles?: Array<Record<string, string>>;
      description?: Record<string, string>;
      contentRating?: string;
      originalLanguage?: string;
      publicationDemographic?: string;
      status?: string;
      tags?: Array<{ attributes: { name: Record<string, string> } }>;
      year?: number;
    };
    relationships: MangadexRelationship[];
  };
};

type MangadexChapterFeedResponse = {
  result: string;
  data: Array<{
    id: string;
    type: string;
    attributes: {
      volume?: string | null;
      chapter?: string | null;
      title?: string | null;
      translatedLanguage: string;
      pages: number;
    };
  }>;
  total: number;
  offset: number;
  limit: number;
};

type MangadexAtHomeReport = {
  url: string;
  success: boolean;
  bytes: number;
  duration: number;
  cached: boolean;
};

function isMangadexImageNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('HTTP 404');
}

async function waitForMangadexImageRecoveryWindow(signal?: AbortSignal): Promise<void> {
  if (MANGADEX_IMAGE_RECOVERY_BACKOFF_MS <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, MANGADEX_IMAGE_RECOVERY_BACKOFF_MS);

    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('aborted'));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const getContextChapterId = (context?: Record<string, unknown>): string | undefined => {
  return typeof context?.chapterId === 'string' && context.chapterId.length > 0
    ? context.chapterId
    : undefined;
};

async function fetchMangadexImageAsset(imageUrl: string, signal?: AbortSignal): Promise<{ data: ArrayBuffer; filename: string; mimeType: string }> {
  const startTime = Date.now();
  let success = false;
  let bytes = 0;
  let cached = false;

  try {
    const response = await fetchWithMangadexRetry(imageUrl, {
      credentials: 'omit',
      signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    cached = response.headers.get('X-Cache')?.startsWith('HIT') ?? false;
    const data = await response.arrayBuffer();
    bytes = data.byteLength;
    success = true;

    const mimeType = response.headers.get('content-type') || 'image/jpeg';
    const urlParts = new URL(imageUrl).pathname.split('/');
    const filename = urlParts[urlParts.length - 1] || 'image.jpg';

    logger.debug('[mangadex] Downloaded chapter image', {
      imageUrl,
      filename,
      mimeType,
      byteLength: bytes,
      cached,
    });

    return { data, filename, mimeType };
  } finally {
    const duration = Date.now() - startTime;
    await reportToMangadexNetwork({ url: imageUrl, success, bytes, duration, cached });
  }
}

async function fetchMangaMetadata(mangaId: string): Promise<MangadexMangaResponse> {
  const url = `${MANGADEX_API_BASE}/manga/${mangaId}?includes[]=author&includes[]=artist&includes[]=cover_art`;
  // Use internal retry logic with X-RateLimit-Retry-After parsing
  const response = await fetchWithMangadexRetry(url, { credentials: 'omit' });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('MangaDex rate limit exceeded. Please wait and try again.');
    }
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return (await response.json()) as MangadexMangaResponse;
}

async function fetchMangaStatistics(mangaId: string): Promise<MangadexStatisticsResponse> {
  const url = `${MANGADEX_API_BASE}/statistics/manga/${mangaId}`;
  const response = await fetchWithMangadexRetry(url, { credentials: 'omit' });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return (await response.json()) as MangadexStatisticsResponse;
}

function mapCommunityRatingToFiveScale(stats: MangadexStatisticsResponse, mangaId: string): number | undefined {
  const bayesian = stats.statistics?.[mangaId]?.rating?.bayesian;
  if (typeof bayesian !== 'number' || Number.isNaN(bayesian)) {
    return undefined;
  }

  // MangaDex bayesian is 1-10; we store ComicInfo-compatible 0-5 scale.
  return Math.max(0, Math.min(5, Number((bayesian / 2).toFixed(2))));
}

async function fetchChapterFeed(
  mangaId: string,
  options: {
    languages?: string[];
    contentRatings?: string[];
  } = {},
  offset: number = 0,
  limit: number = 500
): Promise<MangadexChapterFeedResponse> {
  const params = new URLSearchParams({
    'order[chapter]': 'asc',
    'order[volume]': 'asc',
    offset: String(offset),
    limit: String(limit),
  });

  for (const language of options.languages ?? []) {
    params.append('translatedLanguage[]', language)
  }

  for (const contentRating of options.contentRatings ?? []) {
    params.append('contentRating[]', contentRating)
  }

  const url = `${MANGADEX_API_BASE}/manga/${mangaId}/feed?${params}`;
  // Use internal retry logic with X-RateLimit-Retry-After parsing
  const response = await fetchWithMangadexRetry(url, { credentials: 'omit' });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('MangaDex rate limit exceeded. Please wait and try again.');
    }
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return (await response.json()) as MangadexChapterFeedResponse;
}

async function fetchAtHomeServer(chapterId: string): Promise<AtHomeResponse> {
  const url = `${MANGADEX_API_BASE}/at-home/server/${chapterId}`;
  // Use internal retry logic with X-RateLimit-Retry-After parsing
  const response = await fetchWithMangadexRetry(url, { credentials: 'omit' });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('MangaDex at-home rate limit exceeded (40/min). Please wait.');
    }
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return (await response.json()) as AtHomeResponse;
}

// Cache for user preferences (set by content script, read by background)
let cachedUserPreferences: MangadexUserPreferences | null = null;

/**
 * Set cached user preferences (called from content script)
 */
export function setCachedMangadexPreferences(prefs: MangadexUserPreferences): void {
  cachedUserPreferences = prefs;
  logger.debug('[mangadex] Cached user preferences:', prefs);
}

/**
 * Get cached user preferences (for background/offscreen use)
 */
export function getCachedMangadexPreferences(): MangadexUserPreferences {
  return cachedUserPreferences ?? {
    dataSaver: true,
    filteredLanguages: [],
  };
}

function parseConfiguredMangadexLanguageFilter(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((language): language is string => typeof language === 'string');
}

function resolveMangadexContentRatings(preferences?: MangadexUserPreferences): string[] | undefined {
  if (!preferences) {
    return undefined;
  }

  const hasContentRatingPreference = [
    preferences.showSafe,
    preferences.showSuggestive,
    preferences.showErotic,
    preferences.showHentai,
  ].some((value) => typeof value === 'boolean');

  if (!hasContentRatingPreference) {
    return undefined;
  }

  const ratings: string[] = [];
  if (preferences.showSafe) {
    ratings.push('safe');
  }
  if (preferences.showSuggestive) {
    ratings.push('suggestive');
  }
  if (preferences.showErotic) {
    ratings.push('erotica');
  }
  if (preferences.showHentai) {
    ratings.push('pornographic');
  }

  return ratings;
}

async function resolveMangadexChapterFeedOptions(language?: string): Promise<{
  languages?: string[];
  contentRatings?: string[];
}> {
  let storedSettings: Record<string, unknown> = {};

  try {
    const allSettings = await siteIntegrationSettingsService.getAll();
    const rawSettings = allSettings.mangadex;
    if (rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)) {
      storedSettings = rawSettings as Record<string, unknown>;
    }
  } catch {
    storedSettings = {};
  }

  const autoReadEnabled = storedSettings.autoReadMangaDexSettings !== false;
  const configuredLanguages = parseConfiguredMangadexLanguageFilter(storedSettings.chapterLanguageFilter);
  const cachedPreferences = cachedUserPreferences ?? undefined;

  const languages = language
    ? [language]
    : configuredLanguages !== undefined
      ? configuredLanguages
      : autoReadEnabled
        ? cachedPreferences?.filteredLanguages
        : undefined;

  const contentRatings = autoReadEnabled
    ? resolveMangadexContentRatings(cachedPreferences)
    : undefined;

  return {
    languages: languages && languages.length > 0 ? languages : undefined,
    contentRatings: contentRatings && contentRatings.length > 0 ? contentRatings : undefined,
  };
}

async function reportToMangadexNetwork(report: MangadexAtHomeReport): Promise<void> {
  if (MANGADEX_NETWORK_REPORT_HOST.endsWith('.test')) {
    return;
  }

  if (report.url.includes('mangadex.org')) {
    return;
  }

  if (MANGADEX_TEST_DOMAIN && report.url.includes(MANGADEX_TEST_DOMAIN)) {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MANGADEX_NETWORK_REPORT_TIMEOUT_MS);

  try {
    await fetch(MANGADEX_NETWORK_REPORT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      credentials: 'omit',
      signal: controller.signal,
    });
  } catch (e) {
    logger.debug('[mangadex] Failed to report to network (non-fatal):', e);
  } finally {
    clearTimeout(timeout);
  }
}

function extractPreferredTitle(titles: Record<string, string>, altTitles?: Array<Record<string, string>>): string {
  if (titles.en) return titles.en;
  if (titles['ja-ro']) return titles['ja-ro'];
  const firstKey = Object.keys(titles)[0];
  if (firstKey) return titles[firstKey];

  if (altTitles && altTitles.length > 0) {
    for (const alt of altTitles) {
      if (alt.en) return alt.en;
    }
    const firstAlt = altTitles[0];
    const firstAltKey = Object.keys(firstAlt)[0];
    if (firstAltKey) return firstAlt[firstAltKey];
  }

  return 'Unknown Title';
}

function extractAlternativeTitles(
  altTitles: Array<Record<string, string>> | undefined,
  preferredTitle: string,
): string[] | undefined {
  if (!Array.isArray(altTitles) || altTitles.length === 0) {
    return undefined;
  }

  const uniqueTitles = Array.from(new Set(
    altTitles
      .flatMap((alt) => Object.values(alt))
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value !== preferredTitle),
  ));

  return uniqueTitles.length > 0 ? uniqueTitles : undefined;
}

function formatPublicationDemographic(value: string | undefined): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  return value
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildCoverUrl(mangaId: string, relationships: MangadexRelationship[]): string | undefined {
  const coverRel = relationships.find((r) => r.type === 'cover_art');
  if (!coverRel?.attributes) return undefined;

  const fileName = coverRel.attributes.fileName as string | undefined;
  if (!fileName) return undefined;

  return `${MANGADEX_UPLOADS_BASE}/covers/${mangaId}/${fileName}`;
}

function extractAuthor(relationships: MangadexRelationship[]): string | undefined {
  const authorRel = relationships.find((r) => r.type === 'author');
  if (!authorRel?.attributes) return undefined;
  return authorRel.attributes.name as string | undefined;
}

function extractArtist(relationships: MangadexRelationship[]): string | undefined {
  const artistRel = relationships.find((r) => r.type === 'artist');
  if (!artistRel?.attributes) return undefined;
  return artistRel.attributes.name as string | undefined;
}

function mapMangadexReadingDirection(tags: string[] | undefined): string | undefined {
  if (!Array.isArray(tags) || tags.length === 0) {
    return undefined;
  }

  const normalizedTags = tags.map((tag) => tag.trim().toLowerCase());
  if (normalizedTags.some((tag) => tag === 'manga' || tag === 'doujinshi')) {
    return 'rtl';
  }

  if (normalizedTags.some((tag) => tag === 'manhwa' || tag === 'manhua' || tag === 'webtoon')) {
    return 'ltr';
  }

}

async function fetchMangadexSeriesMetadata(seriesId: string): Promise<SeriesMetadata> {
  const [data, statisticsResult] = await Promise.all([
    fetchMangaMetadata(seriesId),
    fetchMangaStatistics(seriesId).catch((error) => {
      logger.debug('[mangadex] Failed to fetch manga statistics (non-blocking):', error);
      return undefined;
    }),
  ]);
  const attrs = data.data.attributes;

  const title = extractPreferredTitle(attrs.title, attrs.altTitles);
  const description = attrs.description?.en || Object.values(attrs.description || {})[0];
  const status = attrs.status;
  const tagNames = attrs.tags
    ?.map((t) => t.attributes?.name?.en)
    .filter((name): name is string => typeof name === 'string');
  const publicationDemographic = formatPublicationDemographic(attrs.publicationDemographic);
  const genres = Array.from(new Set([
    ...(publicationDemographic ? [publicationDemographic] : []),
    ...(tagNames ?? []),
  ]));
  const alternativeTitles = extractAlternativeTitles(attrs.altTitles, title);
  const author = extractAuthor(data.data.relationships);
  const artist = extractArtist(data.data.relationships);
  const coverUrl = buildCoverUrl(seriesId, data.data.relationships);
  const communityRating = statisticsResult
    ? mapCommunityRatingToFiveScale(statisticsResult, seriesId)
    : undefined;
  const contentRating = typeof attrs.contentRating === 'string' ? attrs.contentRating : undefined;
  const language = typeof attrs.originalLanguage === 'string' ? attrs.originalLanguage : undefined;
  const year = typeof attrs.year === 'number' ? attrs.year : undefined;
  const tags = tagNames && tagNames.length > 0 ? Array.from(new Set(tagNames)) : undefined;
  const readingDirection = mapMangadexReadingDirection(tags);

  return {
    title,
    author,
    artist,
    description,
    genres: genres.length > 0 ? genres : undefined,
    status,
    coverUrl,
    communityRating,
    contentRating,
    readingDirection,
    year,
    language,
    alternativeTitles,
    tags,
  };
}

async function fetchMangadexChapterList(seriesId: string, language?: string): Promise<Chapter[]> {
  const chapterById = new Map<string, Chapter>();
  const duplicateChapterIds = new Set<string>();
  let offset = 0;
  const limit = 500;
  let total = Infinity;
  const feedOptions = await resolveMangadexChapterFeedOptions(language);

  while (offset < total && offset < 10000) {
    const feed = await fetchChapterFeed(seriesId, feedOptions, offset, limit);
    total = feed.total;

    if (offset === 0 && total > 10000) {
      logger.warn(`[mangadex] Series has ${total} chapters but only first 10000 can be retrieved due to API pagination limit`);
    }

    for (const ch of feed.data) {
      if (!ch || typeof ch.id !== 'string' || typeof ch.attributes !== 'object' || ch.attributes === null) {
        logger.warn('[mangadex] Skipping malformed chapter entry in feed response');
        continue;
      }

      const attrs = ch.attributes;
      if (!attrs.translatedLanguage) {
        logger.warn(`[mangadex] Skipping malformed chapter entry with missing language: ${ch.id}`);
        continue;
      }

      const isExternal = Boolean((attrs as unknown as { externalUrl?: string }).externalUrl);
      const pageCount = typeof attrs.pages === 'number' ? attrs.pages : 0;
      const isUnavailable = pageCount === 0;

      const chapterNum = attrs.chapter ? parseFloat(attrs.chapter) : undefined;
      const volumeNum = attrs.volume ? parseInt(attrs.volume, 10) : undefined;
      const volumeLabel = attrs.volume ? `Vol. ${attrs.volume}` : undefined;

      let title = attrs.title || '';
      if (!title && attrs.chapter) {
        title = `Chapter ${attrs.chapter}`;
      }
      if (!title) {
        title = `Chapter ${ch.id.slice(0, 8)}`;
      }

      const chapter: Chapter = {
        id: ch.id,
        url: `${MANGADEX_SITE_BASE}/chapter/${ch.id}`,
        title,
        locked: isExternal || isUnavailable,
        language: attrs.translatedLanguage,
        chapterLabel: typeof attrs.chapter === 'string' && attrs.chapter.trim().length > 0 ? attrs.chapter.trim() : undefined,
        chapterNumber: Number.isNaN(chapterNum) ? undefined : chapterNum,
        volumeNumber: Number.isNaN(volumeNum) ? undefined : volumeNum,
        volumeLabel,
        comicInfo: {
          Title: title,
          LanguageISO: attrs.translatedLanguage,
        },
      };

      if (chapterById.has(ch.id)) {
        duplicateChapterIds.add(ch.id);
        continue;
      }

      chapterById.set(ch.id, chapter);

      if (isExternal) {
        logger.debug(`[mangadex] Marked external chapter as locked: ${ch.id}`);
      }

      if (isUnavailable) {
        logger.debug(`[mangadex] Marked unavailable chapter as locked (0 pages): ${ch.id}`);
      }
    }

    offset += limit;
    if (feed.data.length < limit) break;
  }

  if (duplicateChapterIds.size > 0) {
    logger.error('[mangadex] Duplicate chapter ids detected in fetchChapterList', {
      seriesId,
      duplicateChapterIds: [...duplicateChapterIds],
    });
  }

  return Array.from(chapterById.values());
}

const mangadexContentIntegration: ContentScriptIntegration = {
  name: 'MangaDex API Content',
  series: {
    getSeriesId(): string {
      IntegrationContextValidator.validateContentScriptContext();
      const id = parseUuidFromPath(window.location.pathname, 'title');
      if (!id) {
        throw new Error(`Failed to extract series ID from URL: ${window.location.pathname}`);
      }

      void cacheMangadexPreferencesForSeries(id).catch((error) => {
        logger.debug('[mangadex] Failed to cache localStorage preferences for series', error);
      });
      return id;
    },
  },
};

const mangadexBackgroundIntegration: BackgroundIntegration = {
  name: 'MangaDex API Background',
  series: {
    fetchSeriesMetadata: fetchMangadexSeriesMetadata,
    fetchChapterList: fetchMangadexChapterList,
  },
  async prepareDispatchContext(input): Promise<Record<string, unknown> | undefined> {
    return prepareMangadexDispatchContext({ seriesKey: input.seriesKey });
  },
  chapter: {
    async resolveImageUrls(
      chapter: { id: string; url: string },
      context?: Record<string, unknown>,
    ): Promise<string[]> {
      IntegrationContextValidator.validateBackgroundOrOffscreenContext();
      const chapterId = parseChapterIdFromUrl(chapter.url);
      const atHome = await fetchAtHomeServer(chapterId);
      const quality = await resolveMangadexImageQuality(context);
      const urls = buildPageUrls(atHome, quality);

      logger.debug('[mangadex] Resolved chapter image URLs from at-home server', {
        chapterId,
        chapterUrl: chapter.url,
        quality,
        urlCount: urls.length,
        preferencesSource: getContextMangadexPreferences(context) ? 'integrationContext' : 'inProcessCache',
      });

      if (urls.length === 0) {
        logger.error('[mangadex] No images returned by at-home endpoint', { chapterId, chapterUrl: chapter.url });
      }

      return urls;
    },

    async parseImageUrlsFromHtml({ chapterUrl }: ParseImageUrlsFromHtmlInput): Promise<string[]> {
      IntegrationContextValidator.validateBackgroundOrOffscreenContext();

      const chapterId = parseChapterIdFromUrl(chapterUrl);
      const atHome = await fetchAtHomeServer(chapterId);

      const quality = await resolveMangadexImageQuality();
      const urls = buildPageUrls(atHome, quality);

      logger.debug('[mangadex] Resolved chapter image URLs from at-home server', {
        chapterId,
        chapterUrl,
        quality,
        urlCount: urls.length,
      });

      if (urls.length === 0) {
        logger.error('[mangadex] No images returned by at-home endpoint', { chapterId, chapterUrl });
      }

      return urls;
    },

    processImageUrls(urls: string[]): Promise<string[]> {
      IntegrationContextValidator.validateBackgroundOrOffscreenContext();
      return Promise.resolve(urls.filter((u) => {
        try {
          new URL(u);
          return true;
        } catch {
          return false;
        }
      }));
    },

    async downloadImage(imageUrl: string, opts?: { signal?: AbortSignal; context?: Record<string, unknown> }): Promise<{ data: ArrayBuffer; filename: string; mimeType: string }> {
      IntegrationContextValidator.validateBackgroundOrOffscreenContext();
      if (opts?.signal?.aborted) throw new Error('aborted');

      logger.debug('[mangadex] Downloading chapter image', { imageUrl });
      try {
        return await fetchMangadexImageAsset(imageUrl, opts?.signal);
      } catch (error) {
        const chapterId = getContextChapterId(opts?.context);
        const deliveryTarget = parseMangadexImageDeliveryTarget(imageUrl);
        if (!chapterId || !deliveryTarget || opts?.signal?.aborted) {
          throw error;
        }

        let lastRecoveryError: unknown = error;
        let lastRecoveryUrl: string | undefined;
        let failedOfficialBaseUrl = deliveryTarget.baseUrl;

        for (let cycle = 1; cycle <= MANGADEX_IMAGE_RECOVERY_MAX_CYCLES; cycle++) {
          if (opts?.signal?.aborted) {
            throw new Error('aborted');
          }

          const refreshedAtHome = await fetchAtHomeServer(chapterId);
          const refreshedBaseUrl = normalizeMangadexBaseUrl(refreshedAtHome.baseUrl);
          const useUploadsFallback = isSameMangadexBaseUrl(refreshedBaseUrl, failedOfficialBaseUrl);
          const recoveryUrl = useUploadsFallback
            ? buildMangadexUploadsRecoveryImageUrl(MANGADEX_UPLOADS_BASE, refreshedAtHome, deliveryTarget)
            : resolveMangadexImageUrlForQuality(refreshedAtHome, deliveryTarget);

          logger.warn('[mangadex] Retrying image download with refreshed at-home candidate', {
            chapterId,
            imageUrl,
            cycle,
            refreshedBaseUrl,
            failedOfficialBaseUrl: normalizeMangadexBaseUrl(failedOfficialBaseUrl),
            useUploadsFallback,
            recoveryUrl,
          });

          lastRecoveryUrl = recoveryUrl;
          try {
            return await fetchMangadexImageAsset(recoveryUrl, opts?.signal);
          } catch (recoveryError) {
            lastRecoveryError = recoveryError;
          }

          if (!useUploadsFallback) {
            failedOfficialBaseUrl = refreshedAtHome.baseUrl;
          }

          if (!isMangadexImageNotFoundError(lastRecoveryError) || cycle >= MANGADEX_IMAGE_RECOVERY_MAX_CYCLES) {
            break;
          }

          await waitForMangadexImageRecoveryWindow(opts?.signal);
        }

        const lastRecoveryMessage = lastRecoveryError instanceof Error ? lastRecoveryError.message : String(lastRecoveryError);
        if (lastRecoveryUrl) {
          throw new Error(`${lastRecoveryMessage} (last recovery URL: ${lastRecoveryUrl}; recovery cycles: ${MANGADEX_IMAGE_RECOVERY_MAX_CYCLES})`);
        }

        throw error;
      }
    },
  },
};

export const mangadexIntegration: SiteIntegration = {
  id: 'mangadex',
  content: mangadexContentIntegration,
  background: mangadexBackgroundIntegration,
};

