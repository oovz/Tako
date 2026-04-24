import type { ParseImageUrlsFromHtmlInput } from '@/src/types/site-integrations';
import { rateLimitedFetchByUrlScope } from '@/src/runtime/rate-limit';
import { decodeHtmlResponse } from '@/src/shared/html-response-decoder';
import { filterValidImageUrls } from '@/src/shared/site-integration-utils';
import { resolveImageUrlsFromChapterHtml } from './chapter-viewer';
import { MANHUAGUI_BASE_URL } from './shared';

/**
 * Fetch the chapter viewer HTML and reconstruct the signed image URL list.
 * Mirrors the background integration's `resolveImageUrls` contract: caller
 * receives absolute CDN URLs ready to be downloaded in order.
 */
export async function resolveManhuaguiChapterImageUrls(chapter: { id: string; url: string }): Promise<string[]> {
  const response = await rateLimitedFetchByUrlScope(chapter.url, 'chapter');
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const { html } = await decodeHtmlResponse(response);
  return resolveImageUrlsFromChapterHtml(html);
}

/**
 * HTML-only fallback used when offscreen has already fetched the chapter
 * body. Delegates to the same viewer decoder as
 * {@link resolveManhuaguiChapterImageUrls}.
 */
export function parseManhuaguiImageUrlsFromHtml({ chapterHtml }: ParseImageUrlsFromHtmlInput): Promise<string[]> {
  return resolveImageUrlsFromChapterHtml(chapterHtml);
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
  opts?: { signal?: AbortSignal; context?: Record<string, unknown> },
): Promise<{ data: ArrayBuffer; filename: string; mimeType: string }> {
  if (opts?.signal?.aborted) {
    throw new Error('aborted');
  }

  const response = await rateLimitedFetchByUrlScope(imageUrl, 'image', {
    headers: {
      referer: `${MANHUAGUI_BASE_URL}/`,
    },
    referrer: `${MANHUAGUI_BASE_URL}/`,
    referrerPolicy: 'strict-origin-when-cross-origin',
    signal: opts?.signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.arrayBuffer();
  const mimeType = response.headers.get('content-type') || 'image/jpeg';
  const filename = new URL(imageUrl).pathname.split('/').filter(Boolean).pop() || 'image.jpg';

  return { data, filename, mimeType };
}
