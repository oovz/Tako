import { describe, expect, it, vi } from 'vitest';
import {
  captureBrowserGlobals,
  restoreBrowserGlobals,
  setTestDocument,
  setTestFetch,
  setTestWindow,
} from './shonenjumpplus-test-setup';

export function registerShonenJumpPlusChapterListCases(): void {
  describe('Shonen Jump+ integration', () => {
    it('exposes chapter extraction on the canonical content.series hook', async () => {
      const { shonenJumpPlusIntegration } = await import('@/src/site-integrations/shonenjumpplus');
      expect(typeof shonenJumpPlusIntegration.content.series.extractChapterList).toBe('function');
    });

    it('throws when chapter pagination API context is missing', async () => {
      const snapshot = captureBrowserGlobals();

      setTestWindow({
        location: { origin: 'https://shonenjumpplus.com', pathname: '/episode/10834108156648240735' },
      });
      setTestDocument({
        querySelector: vi.fn(() => null),
      });

      const { shonenJumpPlusIntegration } = await import('@/src/site-integrations/shonenjumpplus');

      await expect(shonenJumpPlusIntegration.content.series.extractChapterList?.()).rejects.toThrow(
        'Shonen Jump+ episode pagination context not found in DOM'
      );

      restoreBrowserGlobals(snapshot);
    });

    it('fetches full chapter list via pagination API and marks paid chapters as locked', async () => {
      const snapshot = captureBrowserGlobals();

      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/readable_product_pagination_information')) {
          return {
            ok: true,
            json: async () => ({ per_page: 2, readable_products_count: 3 }),
          } as Response;
        }

        if (url.includes('offset=0')) {
          return {
            ok: true,
            json: async () => ([
              {
                readable_product_id: '300',
                viewer_uri: '/episode/300',
                title: '3話',
                status: { label: 'is_rentable', rental_price: 40 },
              },
              {
                readable_product_id: '200',
                viewer_uri: '/episode/200',
                title: '2話',
                status: { label: 'is_free', rental_price: null },
              },
            ]),
          } as Response;
        }

        if (url.includes('offset=2')) {
          return {
            ok: true,
            json: async () => ([
              {
                readable_product_id: '100',
                viewer_uri: '/episode/100',
                title: '1話',
                status: { label: 'is_buyable', buy_price: 120 },
              },
            ]),
          } as Response;
        }

        return {
          ok: false,
          status: 404,
          json: async () => ({}),
        } as Response;
      });

      setTestWindow({
        location: {
          origin: 'https://shonenjumpplus.com',
          pathname: '/episode/10834108156648240735',
        },
      });
      setTestDocument({
        querySelector: vi.fn((selector: string) => (
          selector === '.js-readable-products-pagination'
            ? { getAttribute: (name: string) => (name === 'data-aggregate-id' ? '10834108156648240732' : null) }
            : null
        )),
      });
      setTestFetch(fetchMock);

      const { shonenJumpPlusIntegration } = await import('@/src/site-integrations/shonenjumpplus');
      const chapterResult = await shonenJumpPlusIntegration.content.series.extractChapterList?.();
      const chapters = Array.isArray(chapterResult) ? chapterResult : (chapterResult?.chapters ?? []);

      expect(chapters).toHaveLength(3);
      expect(chapters.map(chapter => chapter.id)).toEqual(['300', '200', '100']);
      expect(chapters.map(chapter => chapter.locked)).toEqual([true, false, true]);
      expect(chapters.every(chapter => chapter.volumeLabel === undefined && chapter.volumeNumber === undefined)).toBe(true);

      restoreBrowserGlobals(snapshot);
    });

    it('ignores non-episode entries to keep episodes-only support', async () => {
      const snapshot = captureBrowserGlobals();

      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/readable_product_pagination_information')) {
          return {
            ok: true,
            json: async () => ({ per_page: 50, readable_products_count: 2 }),
          } as Response;
        }

        if (url.includes('/pagination_readable_products')) {
          return {
            ok: true,
            json: async () => ([
              {
                readable_product_id: '900',
                viewer_uri: '/episode/900',
                title: '900話',
                status: { label: 'is_free' },
              },
              {
                readable_product_id: '901',
                viewer_uri: '/volume/901',
                title: '単行本1',
                status: { label: 'is_buyable', buy_price: 600 },
              },
            ]),
          } as Response;
        }

        return {
          ok: false,
          status: 404,
          json: async () => ({}),
        } as Response;
      });

      setTestWindow({
        location: {
          origin: 'https://shonenjumpplus.com',
          pathname: '/episode/10834108156648240735',
        },
      });
      setTestDocument({
        querySelector: vi.fn((selector: string) => (
          selector === '.js-readable-products-pagination'
            ? { getAttribute: (name: string) => (name === 'data-aggregate-id' ? '10834108156648240732' : null) }
            : null
        )),
      });
      setTestFetch(fetchMock);

      const { shonenJumpPlusIntegration } = await import('@/src/site-integrations/shonenjumpplus');
      const chapterResult = await shonenJumpPlusIntegration.content.series.extractChapterList?.();
      const chapters = Array.isArray(chapterResult) ? chapterResult : (chapterResult?.chapters ?? []);

      expect(chapters).toHaveLength(1);
      expect(chapters[0]).toMatchObject({
        id: '900',
        url: 'https://shonenjumpplus.com/episode/900',
        locked: false,
      });

      restoreBrowserGlobals(snapshot);
    });

    it('logs invariant error when duplicate chapter ids are returned with different URLs', async () => {
      const logger = await import('@/src/runtime/logger');
      const snapshot = captureBrowserGlobals();

      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/readable_product_pagination_information')) {
          return {
            ok: true,
            json: async () => ({ per_page: 50, readable_products_count: 2 }),
          } as Response;
        }

        if (url.includes('/pagination_readable_products')) {
          return {
            ok: true,
            json: async () => ([
              {
                readable_product_id: '901',
                viewer_uri: '/episode/901',
                title: '901話',
                status: { label: 'is_free' },
              },
              {
                readable_product_id: '901',
                viewer_uri: '/episode/901?from=alt',
                title: '901話 重複',
                status: { label: 'is_buyable', buy_price: 120 },
              },
            ]),
          } as Response;
        }

        return {
          ok: false,
          status: 404,
          json: async () => ({}),
        } as Response;
      });

      setTestWindow({
        location: {
          origin: 'https://shonenjumpplus.com',
          pathname: '/episode/10834108156648240735',
        },
      });
      setTestDocument({
        querySelector: vi.fn((selector: string) => (
          selector === '.js-readable-products-pagination'
            ? { getAttribute: (name: string) => (name === 'data-aggregate-id' ? '10834108156648240732' : null) }
            : null
        )),
      });
      setTestFetch(fetchMock);

      const { shonenJumpPlusIntegration } = await import('@/src/site-integrations/shonenjumpplus');
      const extractChapterList = shonenJumpPlusIntegration.content.series.extractChapterList;
      expect(extractChapterList).toBeDefined();
      if (!extractChapterList) {
        throw new Error('Expected extractChapterList to be defined');
      }
      const chapterResult = await extractChapterList();
      const chapters = Array.isArray(chapterResult) ? chapterResult : chapterResult.chapters;

      expect(chapters).toHaveLength(1);
      expect(chapters[0].id).toBe('901');
      expect(logger.default.error).toHaveBeenCalledWith(
        '[shonenjumpplus] Duplicate chapter ids detected in fetchChapterList',
        expect.objectContaining({
          aggregateId: '10834108156648240732',
          duplicateChapterIds: ['901'],
        })
      );

      restoreBrowserGlobals(snapshot);
    });
  });
}
