import { test, expect } from '../e2e/fixtures/extension';
import type { BrowserContext } from '@playwright/test';

const MANGA_ID = process.env.TMD_LIVE_MANGADEX_MANGA_ID ?? 'db692d58-4b13-4174-ae8c-30c515c0689c';
let resolvedChapterId = process.env.TMD_LIVE_MANGADEX_CHAPTER_ID ?? '';
const MANGADEX_LIVE_REQUEST_RETRIES = 3;
const MANGADEX_LIVE_RETRY_DELAY_MS = 2_000;

interface MangadexFetchResult {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  data: unknown;
}

async function mangadexFetchViaBrowser(
  context: BrowserContext,
  url: string,
): Promise<MangadexFetchResult> {
  const page = await context.newPage();
  try {
    // Navigate to mangadex.org first so fetch originates from the same origin
    // and passes Cloudflare's browser checks.
    await page.goto('https://mangadex.org', { waitUntil: 'domcontentloaded', timeout: 15_000 });

    let lastResult: MangadexFetchResult | undefined;

    for (let attempt = 0; attempt <= MANGADEX_LIVE_REQUEST_RETRIES; attempt++) {
      const result = await page.evaluate(async (fetchUrl: string): Promise<MangadexFetchResult> => {
        const res = await fetch(fetchUrl, { credentials: 'omit' });
        const text = await res.text();
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
        const headers: Record<string, string> = {};
        res.headers.forEach((value, key) => { headers[key] = value; });
        return { status: res.status, ok: res.ok, headers, data };
      }, url);

      lastResult = result;

      if (result.ok || result.status === 429 || result.status < 500) {
        return result;
      }

      if (attempt < MANGADEX_LIVE_REQUEST_RETRIES) {
        await page.waitForTimeout(MANGADEX_LIVE_RETRY_DELAY_MS);
      }
    }

    if (!lastResult) {
      throw new Error(`MangaDex live request was not attempted: ${url}`);
    }

    return lastResult;
  } finally {
    await page.close();
  }
}

function assertMangadexResponseIsUsable(result: MangadexFetchResult, _endpointName: string): void {
  if (result.status === 429) {
    const retryAfter = result.headers['x-ratelimit-retry-after'];
    expect(retryAfter).toBeDefined();
    return;
  }

  expect(result.ok).toBe(true);
}

test.describe('MangaDex live API contracts', () => {
  test('manga endpoint returns expected core fields', async ({ context }) => {
    const result = await mangadexFetchViaBrowser(
      context,
      `https://api.mangadex.org/manga/${MANGA_ID}?includes[]=author&includes[]=cover_art`,
    );

    assertMangadexResponseIsUsable(result, 'manga endpoint');
    if (!result.ok) {
      return;
    }

    const data = result.data as Record<string, unknown>;
    expect(data).toHaveProperty('result', 'ok');
    expect(data).toHaveProperty('data');
    const dataObj = data.data as Record<string, unknown>;
    expect(dataObj).toHaveProperty('id', MANGA_ID);
    expect(dataObj).toHaveProperty('type', 'manga');
    expect(dataObj).toHaveProperty('attributes');
    expect((dataObj.attributes as Record<string, unknown>)).toHaveProperty('title');
    expect(dataObj).toHaveProperty('relationships');
    expect(Array.isArray(dataObj.relationships)).toBe(true);

    const relationships = dataObj.relationships as Array<{ type: string }>;
    const authorRel = relationships.find((r) => r.type === 'author');
    const coverRel = relationships.find((r) => r.type === 'cover_art');
    expect(authorRel).toBeDefined();
    expect(coverRel).toBeDefined();
  });

  test('manga feed endpoint returns chapter payload shape', async ({ context }) => {
    const result = await mangadexFetchViaBrowser(
      context,
      `https://api.mangadex.org/manga/${MANGA_ID}/feed?translatedLanguage[]=en&limit=5`,
    );

    assertMangadexResponseIsUsable(result, 'feed endpoint');
    if (!result.ok) {
      return;
    }

    const data = result.data as Record<string, unknown>;
    expect(data).toHaveProperty('result', 'ok');
    expect(data).toHaveProperty('data');
    expect(Array.isArray(data.data)).toBe(true);
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('limit');
    expect(data).toHaveProperty('offset');

    const chapters = data.data as Array<Record<string, unknown>>;
    if (chapters.length > 0) {
      // Cache first chapter ID for at-home test
      if (!resolvedChapterId && typeof chapters[0]?.id === 'string') {
        resolvedChapterId = chapters[0].id as string;
      }

      const chapter = chapters[0]!;
      expect(chapter).toHaveProperty('id');
      expect(chapter).toHaveProperty('type', 'chapter');
      expect(chapter).toHaveProperty('attributes');
      expect((chapter.attributes as Record<string, unknown>)).toHaveProperty('translatedLanguage');
    }
  });

  test('at-home endpoint returns server data or rate-limit headers', async ({ context }) => {
    // Resolve chapter ID if not yet cached
    if (!resolvedChapterId) {
      const feedResult = await mangadexFetchViaBrowser(
        context,
        `https://api.mangadex.org/manga/${MANGA_ID}/feed?translatedLanguage[]=en&limit=1`,
      );
      if (feedResult.ok) {
        const feedData = feedResult.data as Record<string, unknown>;
        const feedChapters = Array.isArray(feedData.data) ? feedData.data as Array<Record<string, unknown>> : [];
        if (feedChapters.length > 0 && typeof feedChapters[0]?.id === 'string') {
          resolvedChapterId = feedChapters[0].id as string;
        }
      }
    }

    test.skip(!resolvedChapterId, 'No chapter ID available from feed endpoint');
    const result = await mangadexFetchViaBrowser(
      context,
      `https://api.mangadex.org/at-home/server/${resolvedChapterId}`,
    );

    assertMangadexResponseIsUsable(result, 'at-home endpoint');
    if (!result.ok) {
      return;
    }

    const data = result.data as Record<string, unknown>;
    expect(data).toHaveProperty('result');
    expect(data).toHaveProperty('baseUrl');
    expect(data).toHaveProperty('chapter');
    const chapter = data.chapter as Record<string, unknown>;
    expect(chapter).toHaveProperty('hash');
    expect(chapter).toHaveProperty('data');
    expect(chapter).toHaveProperty('dataSaver');
    expect(Array.isArray(chapter.data)).toBe(true);
    expect(Array.isArray(chapter.dataSaver)).toBe(true);
  });
});
