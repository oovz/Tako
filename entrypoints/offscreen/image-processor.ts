/**
 * Image Processor - Chapter Download and Image Fetching
 * 
 * Handles chapter HTML fetching, image URL extraction, and image downloading
 * using site integration architecture with retry logic and rate limiting.
 */

import { findSiteIntegrationForUrl, siteIntegrationRegistry } from '@/src/runtime/site-integration-registry';
import type { BackgroundIntegration } from '@/src/types/site-integrations';
import type { Chapter } from '@/src/types/chapter';
import { rateLimitedFetchByUrlScope, scheduleForIntegrationScope } from '@/src/runtime/rate-limit';
import { HARD_TIMEOUT_MS, STALL_TIMEOUT_MS } from '@/src/constants/timeouts';
import { decodeHtmlResponse } from '@/src/shared/html-response-decoder';
import logger from '@/src/runtime/logger';

/**
 * Chapter download result
 */
export interface ChapterDownloadResult {
  chapterInfo: Chapter;
  images: Array<{ filename: string; data: ArrayBuffer; mimeType: string }>;
  success: boolean;
  error?: string;
}

/**
 * Image download context
 */
interface ImageDownloadContext {
  integrationId?: string;
  retries: { image: number; chapter: number };
  fetchTimeout: number;
  imageTimeout: number;
}

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

    const mimeTypeRaw = response.headers.get('content-type') ?? '';
    const mimeType = mimeTypeRaw.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream';

    if (!mimeType.startsWith('image/')) {
      throw new Error(`Unsupported MIME type: ${mimeType}`);
    }

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
 * Download a single chapter with site integration architecture
 */
export async function downloadChapter(
  chapter: Chapter,
  context: ImageDownloadContext,
  progressCallback: (progress: number) => void
): Promise<ChapterDownloadResult> {
  try {
    logger.debug(`🔍 Looking for site integration for chapter: ${chapter.url}`);

    const integrationInfo = context.integrationId
      ? siteIntegrationRegistry.findById(context.integrationId)
      : findSiteIntegrationForUrl(chapter.url);
    if (!integrationInfo || !integrationInfo.integration) {
      logger.debug(`❌ No site integration found for URL: ${chapter.url}`);
      logger.debug(`🔍 URL hostname: ${new URL(chapter.url).hostname}`);
      throw new Error(`No site integration found for URL: ${chapter.url}`);
    }

    logger.debug(`🔌 Using site integration: ${integrationInfo.name} for ${chapter.url}`);
    const backgroundIntegration = integrationInfo.integration.background;
    const integrationId = integrationInfo.id;

    // Phase 1/2: Resolve or parse image URLs
    progressCallback(10);
    const imageUrls = backgroundIntegration.chapter.resolveImageUrls
      ? await backgroundIntegration.chapter.resolveImageUrls({ id: chapter.id, url: chapter.url })
      : await (async () => {
        const parseImageUrlsFromHtml = backgroundIntegration.chapter.parseImageUrlsFromHtml;
        if (!parseImageUrlsFromHtml) {
          throw new Error(`Site integration ${integrationId} does not implement resolveImageUrls or parseImageUrlsFromHtml`);
        }

        const html = await withChapterRetries(() => fetchChapterHtml(chapter.url, context.fetchTimeout, integrationId));
        return parseImageUrlsFromHtml({
          chapterId: chapter.id,
          chapterUrl: chapter.url,
          chapterHtml: html,
        });
      })();
    progressCallback(30);

    if (imageUrls.length === 0) {
      throw new Error('No images found in chapter');
    }

    // Process URLs if needed
    const processedUrls = await backgroundIntegration.chapter.processImageUrls(imageUrls, chapter);
    logger.debug(`📊 Found ${processedUrls.length} images for ${chapter.title}`);

    // Phase 3: Download images
    progressCallback(50);
    const imageContext = { ...context, integrationId };
    const images = await downloadImages(
      processedUrls,
      backgroundIntegration,
      imageContext,
      (imageIndex: number) => {
        const progress = 50 + Math.round((imageIndex / processedUrls.length) * 40);
        progressCallback(progress);
      }
    );

    progressCallback(100);

    return {
      chapterInfo: chapter,
      images,
      success: true
    };
  } catch (error) {
    logger.error(`❌ Chapter download failed: ${chapter.title}`, error);
    return {
      chapterInfo: chapter,
      images: [],
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
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
 * Download all images for a chapter with concurrent requests
 */
async function downloadImages(
  imageUrls: string[],
  backgroundIntegration: BackgroundIntegration,
  context: ImageDownloadContext,
  progressCallback: (imageIndex: number) => void
): Promise<Array<{ filename: string; data: ArrayBuffer; mimeType: string }>> {
  const results: Array<{ filename: string; data: ArrayBuffer; mimeType: string } | undefined> = Array.from({ length: imageUrls.length });
  const downloadQueue = new PromiseQueue(16); // Image concurrency cap

  // Get per-image delay from site integration settings
  let imageDelayMs = 0;
  try {
    const integrationId = context.integrationId;
    if (integrationId) {
      const { siteIntegrationSettingsService } = await import('@/src/storage/site-integration-settings-service');
      const values = await siteIntegrationSettingsService.getForSite(integrationId);
      imageDelayMs = typeof values.imageDownloadDelayMs === 'number' ? values.imageDownloadDelayMs : 0;
    }
  } catch (e) {
    logger.debug('Site integration settings unavailable; proceeding with defaults', e);
  }

  const tasks: Promise<void>[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];
    tasks.push(
      downloadQueue.add(async () => {
        try {
          // Optional per-site image delay
          if (imageDelayMs > 0) await new Promise(r => setTimeout(r, imageDelayMs));

          const downloadTask = () => backgroundIntegration.chapter.downloadImage(imageUrl);

          const res = await withTimeout<{
            data: ArrayBuffer;
            filename: string;
            mimeType: string;
          }>(
            maybeWithRetries(
              () => context.integrationId
                ? scheduleForIntegrationScope(context.integrationId, 'image', downloadTask)
                : downloadTask(),
              context.retries.image,
              context.integrationId
            ),
            context.imageTimeout,
            `image ${i + 1} fetch timeout`
          );
          results[i] = { filename: res.filename, data: res.data, mimeType: res.mimeType };
        } catch (e) {
          logger.error(`❌ Image download failed [${i + 1}/${imageUrls.length}]: ${imageUrl}`, e);
        } finally {
          progressCallback(i + 1);
        }
      })
    );
  }

  await Promise.allSettled(tasks);
  return results.filter((v): v is { filename: string; data: ArrayBuffer; mimeType: string } => !!v);
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
 * Conditional retry wrapper based on site integration's handlesOwnRetries flag
 * 
 * When a site integration declares handlesOwnRetries: true, the integration handles retries internally
 * (e.g., MangaDex parses X-RateLimit-Retry-After header). In that case, skip the extension's
 * default retry wrapper and run the function once.
 */
async function maybeWithRetries<T>(
  fn: () => Promise<T>,
  attempts: number,
  integrationId?: string,
  baseDelayMs = 1000
): Promise<T> {
  // Check if site integration handles its own retries
  if (integrationId) {
    const integrationInfo = siteIntegrationRegistry.findById(integrationId);
    if (integrationInfo?.handlesOwnRetries === true) {
      // Skip extension retry wrapper - site integration handles retries internally
      return fn();
    }
  }
  // Apply default retry logic
  return withRetries(fn, attempts, baseDelayMs);
}

/**
 * Chapter-level retry wrapper (simple 2-attempt)
 */
async function withChapterRetries<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    // One quick retry after 300ms
    await new Promise(r => setTimeout(r, 300));
    return await fn();
  }
}

/**
 * Timeout wrapper for promises
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(label || `Operation timed out after ${ms}ms`));
    }, ms);

    promise
      .then(v => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch(e => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
  });
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

    // Get data as ArrayBuffer
    const data = await response.arrayBuffer();

    // Determine MIME type and extension
    const rawType = response.headers.get('content-type');
    const mimeType = rawType || 'image/jpeg';
    let extension: string;
    if (!rawType) {
      // No content-type header provided: default to jpg extension
      extension = 'jpg';
    } else {
      const subtype = mimeType.split('/')[1]?.split(';')[0];
      const lower = (subtype || '').toLowerCase();
      if (lower === 'jpeg') extension = 'jpeg';
      else if (lower === 'jpg') extension = 'jpg';
      else extension = lower || 'jpg';
    }

    logger.debug(`[COVER] Downloaded successfully: ${data.byteLength} bytes, type: ${mimeType}`);
    return { data, mimeType, extension };
  } catch (error) {
    logger.error('[COVER] Download error:', error);
    return null; // Continue without cover
  }
}

/**
 * Export PromiseQueue and helper functions for reuse in other modules
 */
export { PromiseQueue };
export { withRetries, maybeWithRetries, withTimeout, withChapterRetries, fetchChapterHtml, downloadImages };

