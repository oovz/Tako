import { test, expect } from '@playwright/test';

const MANGA_ID = process.env.TMD_LIVE_MANGADEX_MANGA_ID ?? 'f98660a1-d2e2-461c-960d-7bd13df8b76d';
const CHAPTER_ID = process.env.TMD_LIVE_MANGADEX_CHAPTER_ID ?? 'a54c491c-8e4c-4e97-8873-5b79e59da210';

test.describe('MangaDex live API contracts', () => {
  test('manga endpoint returns expected core fields', async ({ request }) => {
    const response = await request.get(
      `https://api.mangadex.org/manga/${MANGA_ID}?includes[]=author&includes[]=cover_art`,
      { timeout: 20_000 },
    );

    if (response.status() === 429) {
      const retryAfter = response.headers()['x-ratelimit-retry-after'];
      expect(retryAfter).toBeDefined();
      return;
    }

    expect(response.ok()).toBe(true);

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
    const response = await request.get(
      `https://api.mangadex.org/manga/${MANGA_ID}/feed?translatedLanguage[]=en&limit=5`,
      { timeout: 20_000 },
    );

    if (response.status() === 429) {
      const retryAfter = response.headers()['x-ratelimit-retry-after'];
      expect(retryAfter).toBeDefined();
      return;
    }

    expect(response.ok()).toBe(true);

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
    const response = await request.get(`https://api.mangadex.org/at-home/server/${CHAPTER_ID}`, {
      timeout: 20_000,
    });

    if (response.status() === 429) {
      const retryAfter = response.headers()['x-ratelimit-retry-after'];
      expect(retryAfter).toBeDefined();
      return;
    }

    expect(response.ok()).toBe(true);

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
