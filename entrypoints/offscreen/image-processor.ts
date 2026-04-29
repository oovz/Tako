/**
 * Image Processor - Chapter Download and Image Fetching
 * 
 * Handles chapter HTML fetching, image URL extraction, and image downloading
 * using site integration architecture with retry logic and rate limiting.
 */

import { rateLimitedFetchByUrlScope, scheduleForIntegrationScope } from '@/src/runtime/rate-limit';
import { HARD_TIMEOUT_MS, STALL_TIMEOUT_MS } from '@/src/constants/timeouts';
import { decodeHtmlResponse } from '@/src/shared/html-response-decoder';
import { normalizeAllowedImageMimeType } from '@/src/shared/site-integration-utils';
import logger from '@/src/runtime/logger';


interface FetchImageWithStallDetectionOptions {
  integrationId?: string;
  signal?: AbortSignal;
  stallTimeoutMs?: number;
  hardTimeoutMs?: number;
}

/**
 * Fetches an image while enforcing both stall timeout (no chunk progress)
 * and hard timeout (total request duration cap), with MIME validation.
 */
export async function fetchImageWithStallDetection(
  imageUrl: string,
  options: FetchImageWithStallDetectionOptions = {}
): Promise<{ data: ArrayBuffer; mimeType: string }> {
  const stallTimeoutMs = options.stallTimeoutMs ?? STALL_TIMEOUT_MS;
  const hardTimeoutMs = options.hardTimeoutMs ?? HARD_TIMEOUT_MS;

  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onAbort, { once: true });

  const hardTimeoutId = setTimeout(() => {
    controller.abort(new Error(`Image download hard timeout after ${hardTimeoutMs}ms`));
  }, hardTimeoutMs);

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  try {
    const fetchImage = () =>
      rateLimitedFetchByUrlScope(imageUrl, 'image', {
        signal: controller.signal,
        credentials: 'include',
      });

    const response = options.integrationId
      ? await scheduleForIntegrationScope(options.integrationId, 'image', fetchImage)
      : await fetchImage();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const mimeType = normalizeAllowedImageMimeType(response.headers.get('content-type'));

    if (!response.body) {
      const data = await response.arrayBuffer();
      return { data, mimeType };
    }

    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      let stallTimeoutId: ReturnType<typeof setTimeout> | null = null;

      try {
        const readResult = await Promise.race<ReadableStreamReadResult<Uint8Array>>([
          reader.read(),
          new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
            stallTimeoutId = setTimeout(() => {
              reject(new Error(`Image download stalled after ${stallTimeoutMs}ms`));
            }, stallTimeoutMs);
          }),
        ]);

        if (stallTimeoutId) {
          clearTimeout(stallTimeoutId);
        }

        if (readResult.done) {
          break;
        }

        if (readResult.value && readResult.value.byteLength > 0) {
          chunks.push(readResult.value);
          totalBytes += readResult.value.byteLength;
        }
      } catch (error) {
        if (stallTimeoutId) {
          clearTimeout(stallTimeoutId);
        }
        throw error;
      }
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      data: merged.buffer,
      mimeType,
    };
  } finally {
    clearTimeout(hardTimeoutId);
    options.signal?.removeEventListener('abort', onAbort);
    try {
      reader?.releaseLock();
    } catch {
      // no-op
    }
  }
}

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
async function fetchChapterHtml(chapterUrl: string, timeoutMs: number, integrationId?: string): Promise<string> {
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
        response = await scheduleForIntegrationScope(integrationId, 'chapter', fetchFn);
      } else {
        response = await rateLimitedFetchByUrlScope(chapterUrl, 'chapter', {
          signal: controller.signal,
          credentials: 'include'
        } as RequestInit);
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

async function withRetries<T>(fn: () => Promise<T>, attempts: number, baseDelayMs = 1000): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
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

    // Apply rate limiting with same scope as chapter images
    const response = await withRetries(
      () => rateLimitedFetchByUrlScope(coverUrl, 'image'),
      retries,
      300 // Base delay for retries
    );

    if (!response.ok) {
      logger.warn(`[COVER] Fetch failed: ${response.status} ${response.statusText}`);
      return null; // Graceful fallback
    }

    const mimeType = normalizeAllowedImageMimeType(response.headers.get('content-type'));

    // Get data as ArrayBuffer
    const data = await response.arrayBuffer();

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

