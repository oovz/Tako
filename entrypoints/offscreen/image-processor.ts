/**
 * Image Processor - Chapter Download and Image Fetching
 * 
 * Handles chapter HTML fetching, image URL extraction, and image downloading
 * using site integration architecture with retry logic and rate limiting.
 */

import { rateLimitedFetchByUrlScope, scheduleForIntegrationScope } from '@/src/runtime/rate-limit';
import type { EffectivePolicy } from '@/src/runtime/rate-limit';
import { decodeHtmlResponse } from '@/src/shared/html-response-decoder';
import { fetchImageWithStallDetection } from '@/src/runtime/fetch-image';
import logger from '@/src/runtime/logger';

export { fetchImageWithStallDetection };

/**
 * Promise queue for managing concurrent operations
 */
class PromiseQueue {
  private maxConcurrent: number;
  private running: number;
  private queue: Array<{
    task: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  }>;

  constructor(maxConcurrent: number = 8) {
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
    this.queue = [];
  }

  add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        task,
        resolve: (v: unknown) => resolve(v as T),
        reject: (r?: unknown) => reject(r instanceof Error ? r : new Error(String(r)))
      });
      this._runNext();
    });
  }

  cancelPending(reason: unknown = new Error('queue-cancelled')): number {
    const pending = this.queue.splice(0, this.queue.length);
    for (const item of pending) {
      item.reject(reason);
    }
    return pending.length;
  }

  private _runNext(): void {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const { task, resolve, reject } = this.queue.shift()!;
    this.running++;

    const promise = task();
    promise.then(resolve, reject).finally(() => {
      this.running--;
      this._runNext();
    });
  }
}

/**
 * Fetch chapter HTML with timeout and retry.
 *
 * HTML bytes are decoded strictly from the response's declared charset metadata
 * (BOM, Content-Type, or <meta charset>). Undeclared or mismatched encodings are
 * treated as hard failures instead of guessing fallback decoders.
 */
async function fetchChapterHtml(
  chapterUrl: string,
  timeoutMs: number,
  integrationId?: string,
  rateLimitPolicy?: EffectivePolicy,
): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('fetch-html-timeout')), timeoutMs);
    let response: Response;
    try {
      const fetchFn = () => fetch(chapterUrl, {
        signal: controller.signal,
        credentials: 'include'
      });

      if (integrationId) {
        response = await scheduleForIntegrationScope(integrationId, 'chapter', fetchFn, rateLimitPolicy);
      } else {
        response = await rateLimitedFetchByUrlScope(chapterUrl, 'chapter', {
          signal: controller.signal,
          credentials: 'include'
        } as RequestInit, rateLimitPolicy);
      }
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const decoded = await decodeHtmlResponse(response);
    const html = decoded.html;
    logger.debug(`📄 Fetched HTML for ${chapterUrl} (${html.length} chars, encoding=${decoded.encoding}, source=${decoded.source})`);

    return html;
  } catch (error) {
    logger.error(`❌ Failed to fetch HTML: ${chapterUrl}`, error);
    throw error;
  }
}


/**
 * Retry wrapper with exponential backoff
 */
function getHttpStatusFromError(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const match = error.message.match(/HTTP\s+(\d{3})/);
  if (!match) return null;
  const code = Number.parseInt(match[1], 10);
  return Number.isNaN(code) ? null : code;
}

function isCancellationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === 'AbortError') {
    return true;
  }

  const message = error.message.toLowerCase();
  return message === 'aborted' || message.includes('job-cancelled');
}

async function withRetries<T>(
  fn: () => Promise<T>,
  attempts: number,
  baseDelayMs = 1000,
  hooks?: { onAttemptStart?: (attempt: number) => void | Promise<void> },
): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await hooks?.onAttemptStart?.(attempt);
      return await fn();
    } catch (error) {
      if (isCancellationError(error)) {
        throw error;
      }
      if (attempt === attempts) throw error;
      const status = getHttpStatusFromError(error);
      if (status !== null && status >= 400 && status < 500 && status !== 429) {
        throw error;
      }
      const delay = baseDelayMs * Math.pow(3, attempt - 1);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Retry failed'); // Never reached
}


/**
 * Download series cover image with rate limiting
 * Cover image inclusion
 * 
 * @param coverUrl - URL of the cover image
 * @param integrationId - Site integration ID for rate limiting scope
 * @param retries - Number of retry attempts
 * @returns Cover image data with extension, or null if unavailable
 */
export async function downloadCoverImage(
  coverUrl: string | undefined,
  integrationId: string | undefined,
  fetchTimeoutMs: number,
  retries: number = 3
): Promise<{ data: ArrayBuffer; mimeType: string; extension: string } | null> {
  if (!coverUrl) {
    logger.debug('[COVER] No cover URL provided');
    return null;
  }

  try {
    logger.debug('[COVER] Downloading:', coverUrl);

    const { data, mimeType } = await withRetries(
      () => fetchImageWithStallDetection(coverUrl, {
        stallTimeoutMs: fetchTimeoutMs,
        hardTimeoutMs: fetchTimeoutMs,
      }),
      retries,
      300 // Base delay for retries
    );

    const subtype = mimeType.split('/')[1];
    let extension: string;
    if (subtype === 'jpeg') extension = 'jpeg';
    else if (subtype === 'jpg') extension = 'jpg';
    else extension = subtype || 'jpg';

    logger.debug(`[COVER] Downloaded successfully: ${data.byteLength} bytes, type: ${mimeType}`);
    return { data, mimeType, extension };
  } catch (error) {
    logger.error('[COVER] Download error:', error);
    return null; // Continue without cover
  }
}

export { PromiseQueue, withRetries, fetchChapterHtml };

