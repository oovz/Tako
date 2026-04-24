import { sanitizeLabel } from '@/src/shared/site-integration-utils';

/**
 * Canonical Manhuagui origin used for building absolute URLs from relative
 * links and as the `Referer` header when downloading CDN images.
 */
export const MANHUAGUI_BASE_URL = 'https://www.manhuagui.com';

/** Default protocol used when constructing absolute image URLs. */
export const DEFAULT_IMAGE_PROTOCOL = 'https:';

/** Matches `/comic/{id}` or `/comic/{id}/` (trailing slash optional). */
export const SERIES_PATH_REGEX = /^\/comic\/(\d+)\/?$/;

/** Matches `/comic/{seriesId}/{chapterId}.html`, optionally with `_p{index}` suffix. */
export const CHAPTER_PATH_REGEX = /^\/comic\/\d+\/(\d+)(?:_p\d+)?\.html$/;

export function parseSeriesIdFromPath(pathname: string): string | null {
  return pathname.match(SERIES_PATH_REGEX)?.[1] ?? null;
}

export function parseChapterIdFromUrl(url: string): string | null {
  try {
    return new URL(url).pathname.match(CHAPTER_PATH_REGEX)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve a possibly-relative URL (`//host/path`, `/path`, `path`) against the
 * Manhuagui origin. Returns `undefined` when the input is empty or malformed so
 * callers can `??`-chain through multiple candidate attributes.
 */
export function toAbsoluteUrl(url: string | null | undefined, baseUrl: string = MANHUAGUI_BASE_URL): string | undefined {
  const raw = sanitizeLabel(url ?? '');
  if (!raw) {
    return undefined;
  }

  if (raw.startsWith('//')) {
    return `https:${raw}`;
  }

  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return undefined;
  }
}
