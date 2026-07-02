import type { ParseImageUrlsFromHtmlInput } from '@/src/types/site-integrations';
import {
  getRateLimitPolicyFromContext,
  getRateLimitPolicyFromSnapshot,
  rateLimitedFetchByUrlScope,
  type EffectivePolicy,
} from '@/src/runtime/rate-limit';
import { fetchImageWithStallDetection } from '@/src/runtime/fetch-image';
import type { TaskSettingsSnapshot } from '@/src/types/state-snapshots';
import { decodeHtmlResponse } from '@/src/shared/html-response-decoder';
import { resolveImageUrlsFromChapterHtml } from './chapter-viewer';
import { MANHUAGUI_BASE_URL } from './shared';
import { filterValidImageUrls } from '@/src/shared/site-integration-utils';

/**
 * Fetch the chapter viewer HTML and reconstruct the signed image URL list.
 * Mirrors the background integration's `resolveImageUrls` contract: caller
 * receives absolute CDN URLs ready to be downloaded in order.
 */
export async function resolveManhuaguiChapterImageUrls(
  chapter: { id: string; url: string },
  settingsSnapshot?: Partial<TaskSettingsSnapshot>,
): Promise<string[]> {
  const chapterPolicy = getRateLimitPolicyFromSnapshot(settingsSnapshot, 'chapter');
  const response = await rateLimitedFetchByUrlScope(chapter.url, 'chapter', undefined, chapterPolicy);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const { html } = await decodeHtmlResponse(response);
  return resolveImageUrlsFromChapterHtml(html, chapterPolicy);
}

/**
 * HTML-only fallback used when offscreen has already fetched the chapter
 * body. Delegates to the same viewer decoder as
 * {@link resolveManhuaguiChapterImageUrls}.
 */
export function parseManhuaguiImageUrlsFromHtml(
  { chapterHtml }: ParseImageUrlsFromHtmlInput,
  chapterPolicy?: EffectivePolicy,
): Promise<string[]> {
  return resolveImageUrlsFromChapterHtml(chapterHtml, chapterPolicy);
}

/** Filter out malformed entries before download (shared URL validity check). */
export function processManhuaguiImageUrls(urls: string[]): Promise<string[]> {
  return Promise.resolve(filterValidImageUrls(urls));
}

/**
 * Download a single Manhuagui chapter image. The hamreus.com CDN rejects
 * requests missing the Manhuagui origin as referrer; we set both the
 * `referer` header (best-effort, may be stripped by the browser as a
 * forbidden header) and the RequestInit `referrer` option (honored), with
 * `strict-origin-when-cross-origin` so only the origin is leaked across
 * domains.
 */
export async function downloadManhuaguiChapterImage(
  imageUrl: string,
  opts?: {
    signal?: AbortSignal
    context?: Record<string, unknown>
    skipRateLimit?: boolean
    onBytesReceived?: (bytesReceived: number) => void | Promise<void>
  },
): Promise<{ data: ArrayBuffer; filename: string; mimeType: string }> {
  if (opts?.signal?.aborted) {
    throw new Error('aborted');
  }

  const { data, mimeType } = await fetchImageWithStallDetection(imageUrl, {
    signal: opts?.signal,
    rateLimitPolicy: getRateLimitPolicyFromContext(opts?.context, 'image'),
    skipRateLimit: opts?.skipRateLimit,
    onBytesReceived: opts?.onBytesReceived,
    init: {
      headers: {
        referer: `${MANHUAGUI_BASE_URL}/`,
      },
      referrer: `${MANHUAGUI_BASE_URL}/`,
      referrerPolicy: 'strict-origin-when-cross-origin',
    },
  });
  const filename = new URL(imageUrl).pathname.split('/').filter(Boolean).pop() || 'image.jpg';

  return { data, filename, mimeType };
}
