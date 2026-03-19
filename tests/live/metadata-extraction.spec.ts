import { test, expect } from '../e2e/fixtures/extension';
import { getTabId, getSessionState } from '../e2e/fixtures/state-helpers';
import { testCases } from './test-cases';

// Simple normalizer for loose string matching
function norm(v: unknown): string {
  return String(v ?? '').toLowerCase().trim();
}

// Map ComicInfoV2 keys to values available in tab state
function resolveActualValue(key: string, extracted: unknown, pageUrl: string): any {
  const md = (extracted as any)?.metadata || {};
  switch (key) {
    case 'Series':
      return (extracted as any)?.seriesTitle || md.title;
    case 'Writer':
    case 'Penciller':
    case 'Inker':
    case 'Colorist':
    case 'Letterer':
    case 'CoverArtist':
    case 'Editor':
      return md.author; // current site integrations expose a single author field
    case 'Summary':
      return md.description;
    case 'Genre': {
      const genres = Array.isArray(md.genres) ? md.genres.join(', ') : md.genres || '';
      return genres;
    }
    case 'Year':
      return md.year;
    case 'Web':
      return pageUrl;
    default:
      throw new Error(`Unsupported expectedMetadata field in live test: ${key}`);
  }
}

// Assert expected vs actual for a key
function assertField(key: string, expectedVal: unknown, extracted: unknown, pageUrl: string) {
  const actual = resolveActualValue(key, extracted, pageUrl);
  if (typeof expectedVal === 'number') {
    expect(actual).toBe(expectedVal);
    return;
  }
  if (Array.isArray(expectedVal)) {
    // Every expected token should be present in actual string/list
    const hay = Array.isArray(actual) ? actual.map(norm) : norm(actual);
    for (const token of expectedVal) {
      const needle = norm(token);
      if (Array.isArray(hay)) {
        expect(hay).toContain(needle);
      } else {
        expect(hay).toContain(needle);
      }
    }
    return;
  }
  // String-ish fallback: substring match
  expect(norm(actual)).toContain(norm(expectedVal));
}

test.describe('Live Metadata Extraction', () => {
  for (const testCase of testCases) {
    test(`Extract metadata from ${testCase.url}`, async ({ context, extensionId }) => {
      const page = await context.newPage();
      const logs: string[] = [];
      page.on('console', (msg: any) => {
        logs.push(`${msg.type()}: ${msg.text()}`);
      });

      // 1) Open the target live URL
      await page.goto(testCase.url, { waitUntil: 'domcontentloaded' });

      // 2) Open an extension page (options) to communicate with background
      const options = await context.newPage();
      await options.goto(`chrome-extension://${extensionId}/options.html`);

      // Resolve target tab through shared helper used by E2E flows.
      const tabId = await getTabId(page, context);
      expect(tabId).toBeTruthy();

      const targetUrl = page.url();
      const candidateTabIds = await options.evaluate(
        async ({ preferredTabId, targetHref }: { preferredTabId: number; targetHref: string }) => {
          const target = new URL(targetHref);
          const allTabs = await chrome.tabs.query({});

          const urlMatchedIds = allTabs
            .filter((tab) => {
              if (typeof tab.id !== 'number' || !tab.url) return false;
              try {
                const u = new URL(tab.url);
                if (u.hostname !== target.hostname) return false;

                if (u.pathname === target.pathname) return true;
                return u.pathname.startsWith(target.pathname) || target.pathname.startsWith(u.pathname);
              } catch {
                return false;
              }
            })
            .map((tab) => tab.id as number);

          return [preferredTabId, ...urlMatchedIds].filter(
            (id, index, arr): id is number => typeof id === 'number' && arr.indexOf(id) === index,
          );
        },
        { preferredTabId: tabId as number, targetHref: targetUrl },
      );

      expect(candidateTabIds.length).toBeGreaterThan(0);

      // Kick/re-kick content initialization on the exact target tab.
      await options.evaluate(async (candidateIds: number[]) => {
        const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

        for (const tid of candidateIds) {
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tid },
                files: ['content-scripts/content.js'],
              });
              break;
            } catch {
              await wait(750);
            }
          }
        }
      }, candidateTabIds);

      // 3) Poll session storage for target tab state set by the content script
      const findReadyState = async (): Promise<{ tabId: number; state: any } | null> => {
        for (const targetTabId of candidateTabIds) {
          const s: any = await getSessionState(context, `tab_${targetTabId}`);
          if (!s || !s.siteIntegrationId) continue;

          const siteOk = s.siteIntegrationId === testCase.integration;
          const title = (s.metadata?.title || s.seriesTitle || '').toLowerCase();
          const expectedSeries = (testCase.expectedMetadata?.Series || '').toLowerCase();
          const titleOk = expectedSeries ? title.includes(expectedSeries) : true;
          const hasSeriesIdentity = typeof s.mangaId === 'string' && s.mangaId.length > 0;

          if (siteOk && titleOk && hasSeriesIdentity) {
            return { tabId: targetTabId, state: s };
          }
        }

        const fallback = await options.evaluate(async (expectedIntegration: string) => {
          const allSession = await chrome.storage.session.get(null);
          for (const [key, raw] of Object.entries(allSession)) {
            if (!key.startsWith('tab_')) continue;
            const s: any = raw;
            if (!s || s.siteIntegrationId !== expectedIntegration) continue;

            const hasSeriesIdentity = typeof s.mangaId === 'string' && s.mangaId.length > 0;
            if (hasSeriesIdentity) {
              return { tabId: Number(key.replace('tab_', '')), state: s };
            }
          }

          return null;
        }, testCase.integration);

        return fallback;
      };

      const timeoutMs = 75_000;
      const pollMs = 500;
      const maxReinitBursts = 2;
      let reinitBursts = 0;
      const start = Date.now();
      let extractedResult: { tabId: number; state: any } | null = null;

      while (Date.now() - start < timeoutMs) {
        extractedResult = await findReadyState();
        if (extractedResult) break;

        const elapsed = Date.now() - start;
        if (reinitBursts < maxReinitBursts && elapsed > (reinitBursts + 1) * 10_000) {
          await options.evaluate(async (candidateIds: number[]) => {
            for (const tid of candidateIds) {
              try {
                await chrome.scripting.executeScript({
                  target: { tabId: tid },
                  files: ['content-scripts/content.js'],
                });
              } catch {
                void 0;
              }
            }
          }, candidateTabIds);
          reinitBursts += 1;
        }

        await page.waitForTimeout(pollMs);
      }

      expect(extractedResult).toBeTruthy();

      const extracted = extractedResult?.state;

      // 4) Validate site integration id recorded in state
      expect(extracted.siteIntegrationId).toBe(testCase.integration);
      expect(typeof extracted.mangaId).toBe('string');
      expect((extracted.mangaId as string).length).toBeGreaterThan(0);
      expect(typeof extracted.seriesTitle).toBe('string');
      expect((extracted.seriesTitle as string).length).toBeGreaterThan(0);
      expect(Array.isArray(extracted.chapters)).toBe(true);

      // 5) Validate all fields present in expectedMetadata
      for (const [key, val] of Object.entries(testCase.expectedMetadata)) {
        assertField(key, val as unknown, extracted, testCase.url);
      }

      await options.close();
      await page.close();
    });
  }
  
  test('At least one test case is configured', () => {
    expect(testCases.length).toBeGreaterThan(0);
  });
});
