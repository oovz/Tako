import { test, expect } from '@playwright/test';
import type { APIRequestContext, APIResponse } from '@playwright/test';

const MANGA_ID = process.env.TMD_LIVE_MANGADEX_MANGA_ID ?? 'f98660a1-d2e2-461c-960d-7bd13df8b76d';
const CHAPTER_ID = process.env.TMD_LIVE_MANGADEX_CHAPTER_ID ?? 'a54c491c-8e4c-4e97-8873-5b79e59da210';
const MANGADEX_TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);
const MANGADEX_LIVE_REQUEST_RETRIES = 3;
const MANGADEX_LIVE_RETRY_DELAY_MS = 5_000;

async function waitForMangadexLiveRetry(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, MANGADEX_LIVE_RETRY_DELAY_MS));
}

async function getMangadexWithTransientRetry(
  request: APIRequestContext,
  url: string,
): Promise<APIResponse> {
  let response: APIResponse | undefined;

  for (let attempt = 0; attempt <= MANGADEX_LIVE_REQUEST_RETRIES; attempt++) {
    response = await request.get(url, { timeout: 20_000 });
    if (response.ok() || response.status() === 429 || !MANGADEX_TRANSIENT_STATUSES.has(response.status())) {
      return response;
    }

    if (attempt < MANGADEX_LIVE_REQUEST_RETRIES) {
      await response.dispose();
      await waitForMangadexLiveRetry();
    }
  }

  if (!response) {
    throw new Error(`MangaDex live request was not attempted: ${url}`);
  }

  return response;
}

function assertMangadexResponseIsUsable(response: APIResponse, endpointName: string): void {
  if (response.status() === 429) {
    const retryAfter = response.headers()['x-ratelimit-retry-after'];
    expect(retryAfter).toBeDefined();
    return;
  }

  test.skip(
    MANGADEX_TRANSIENT_STATUSES.has(response.status()),
    `MangaDex ${endpointName} returned transient HTTP ${response.status()} after retries`,
  );

  expect(response.ok()).toBe(true);
}

test.describe('MangaDex live API contracts', () => {
  test('manga endpoint returns expected core fields', async ({ request }) => {
    const response = await getMangadexWithTransientRetry(
      request,
      `https://api.mangadex.org/manga/${MANGA_ID}?includes[]=author&includes[]=cover_art`,
    );

    assertMangadexResponseIsUsable(response, 'manga endpoint');
    if (!response.ok()) {
      return;
    }

    const data = await response.json();
    expect(data).toHaveProperty('result', 'ok');
    expect(data).toHaveProperty('data');
    expect(data.data).toHaveProperty('id', MANGA_ID);
    expect(data.data).toHaveProperty('type', 'manga');
    expect(data.data).toHaveProperty('attributes');
    expect(data.data.attributes).toHaveProperty('title');
    expect(data.data).toHaveProperty('relationships');
    expect(Array.isArray(data.data.relationships)).toBe(true);

    const authorRel = data.data.relationships.find((r: { type: string }) => r.type === 'author');
    const coverRel = data.data.relationships.find((r: { type: string }) => r.type === 'cover_art');
    expect(authorRel).toBeDefined();
    expect(coverRel).toBeDefined();
  });

  test('manga feed endpoint returns chapter payload shape', async ({ request }) => {
    const response = await getMangadexWithTransientRetry(
      request,
      `https://api.mangadex.org/manga/${MANGA_ID}/feed?translatedLanguage[]=en&limit=5`,
    );

    assertMangadexResponseIsUsable(response, 'feed endpoint');
    if (!response.ok()) {
      return;
    }

    const data = await response.json();
    expect(data).toHaveProperty('result', 'ok');
    expect(data).toHaveProperty('data');
    expect(Array.isArray(data.data)).toBe(true);
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('limit');
    expect(data).toHaveProperty('offset');

    if (data.data.length > 0) {
      const chapter = data.data[0];
      expect(chapter).toHaveProperty('id');
      expect(chapter).toHaveProperty('type', 'chapter');
      expect(chapter).toHaveProperty('attributes');
      expect(chapter.attributes).toHaveProperty('translatedLanguage');
    }
  });

  test('at-home endpoint returns server data or rate-limit headers', async ({ request }) => {
    const response = await getMangadexWithTransientRetry(
      request,
      `https://api.mangadex.org/at-home/server/${CHAPTER_ID}`,
    );

    assertMangadexResponseIsUsable(response, 'at-home endpoint');
    if (!response.ok()) {
      return;
    }

    const data = await response.json();
    expect(data).toHaveProperty('result');
    expect(data).toHaveProperty('baseUrl');
    expect(data).toHaveProperty('chapter');
    expect(data.chapter).toHaveProperty('hash');
    expect(data.chapter).toHaveProperty('data');
    expect(data.chapter).toHaveProperty('dataSaver');
    expect(Array.isArray(data.chapter.data)).toBe(true);
    expect(Array.isArray(data.chapter.dataSaver)).toBe(true);
  });
});
