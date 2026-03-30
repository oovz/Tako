import { describe, expect, it } from 'vitest';
import { mockRateLimitedFetch } from './pixiv-comic-test-setup';

export function registerPixivComicSeriesApiCases(): void {
  describe('Pixiv Comic integration', () => {
    it('fetches series metadata from works/v5 API including author', async () => {
      mockRateLimitedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            official_work: {
              id: 9012,
              name: '煙たい話',
              author: '林史也',
              description: '★コミックス①〜⑥巻好評発売中★<br><br>恋じゃない。',
              image: {
                main_big: 'https://img-comic.pximg.net/images/work_main/9012.jpg',
                thumbnail: 'https://public-img-comic.pximg.net/images/work_thumbnail/9012.jpg',
              },
            },
          },
        }),
      });

      const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
      const metadata = await pixivComicIntegration.background.series!.fetchSeriesMetadata('9012');

      expect(metadata).toMatchObject({
        title: '煙たい話',
        author: '林史也',
        description: '★コミックス①〜⑥巻好評発売中★ 恋じゃない。',
        coverUrl: 'https://img-comic.pximg.net/images/work_main/9012.jpg',
      });
    });

    it('fetches chapter list from episodes/v2 API and maps readable/locked entries', async () => {
      mockRateLimitedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            episodes: [
              {
                state: 'readable',
                episode: {
                  id: 136645,
                  numbering_title: '第1話',
                  sub_title: '',
                  viewer_path: '/viewer/stories/136645',
                },
              },
              {
                state: 'unreadable',
                episode: {
                  id: 200001,
                  numbering_title: '第2話',
                  sub_title: '有料',
                  viewer_path: '/viewer/stories/200001',
                },
              },
            ],
          },
        }),
      });

      const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
      const chapterResult = await pixivComicIntegration.background.series!.fetchChapterList('9012');
      const chapters = Array.isArray(chapterResult) ? chapterResult : chapterResult.chapters;

      expect(chapters).toHaveLength(2);
      expect(chapters[0]).toMatchObject({
        id: '136645',
        url: 'https://comic.pixiv.net/viewer/stories/136645',
        title: '第1話',
        locked: false,
        chapterNumber: 1,
      });
      expect(chapters[1]).toMatchObject({
        id: '200001',
        url: 'https://comic.pixiv.net/viewer/stories/200001',
        title: '第2話 有料',
        locked: true,
        chapterNumber: 2,
      });
    });

    it('keeps repeated Pixiv chapter titles as separate chapters when ids and urls differ', async () => {
      mockRateLimitedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            episodes: [
              {
                state: 'readable',
                episode: {
                  id: 79887,
                  numbering_title: '第1話',
                  sub_title: '',
                  viewer_path: '/viewer/stories/79887',
                },
              },
              {
                state: 'readable',
                episode: {
                  id: 126686,
                  numbering_title: '第1話',
                  sub_title: '',
                  viewer_path: '/viewer/stories/126686',
                },
              },
            ],
          },
        }),
      });

      const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
      const chapterResult = await pixivComicIntegration.background.series!.fetchChapterList('6842');
      const chapters = Array.isArray(chapterResult) ? chapterResult : chapterResult.chapters;

      expect(chapters).toHaveLength(2);
      expect(chapters.map(chapter => chapter.title)).toEqual(['第1話', '第1話']);
      expect(chapters.map(chapter => chapter.chapterNumber)).toEqual([1, 1]);
      expect(chapters.map(chapter => chapter.id)).toEqual(['79887', '126686']);
    });

    it('combines numbering title and subtitle while parsing full-width Pixiv chapter numerals', async () => {
      mockRateLimitedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            episodes: [
              {
                state: 'readable',
                episode: {
                  id: 68314,
                  numbering_title: '第１話',
                  sub_title: '岡野部長は友達がいない(1)',
                  viewer_path: '/viewer/stories/68314',
                },
              },
            ],
          },
        }),
      });

      const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
      const chapterResult = await pixivComicIntegration.background.series!.fetchChapterList('6289');
      const chapters = Array.isArray(chapterResult) ? chapterResult : chapterResult.chapters;

      expect(chapters).toHaveLength(1);
      expect(chapters[0]).toMatchObject({
        id: '68314',
        url: 'https://comic.pixiv.net/viewer/stories/68314',
        title: '第１話 岡野部長は友達がいない(1)',
        chapterLabel: '第１話',
        chapterNumber: 1,
        locked: false,
      });
    });

    it('requests chapter list using ascending order to match 最初から order', async () => {
      mockRateLimitedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { episodes: [] } }),
      });

      const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
      await pixivComicIntegration.background.series!.fetchChapterList('9012');

      const calls = mockRateLimitedFetch.mock.calls.map(call => String(call[0]));
      expect(calls.some(url => url.includes('/api/app/works/9012/episodes/v2?order=asc'))).toBe(true);
    });

    it('deduplicates chapters by URL and keeps the readable entry', async () => {
      mockRateLimitedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            episodes: [
              {
                state: 'unreadable',
                episode: {
                  id: 300001,
                  numbering_title: '第3話',
                  sub_title: '先行配信',
                  viewer_path: '/viewer/stories/300001',
                },
              },
              {
                state: 'readable',
                episode: {
                  id: 300001,
                  numbering_title: '第3話',
                  sub_title: '',
                  viewer_path: '/viewer/stories/300001',
                },
              },
            ],
          },
        }),
      });

      const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
      const chapterResult = await pixivComicIntegration.background.series!.fetchChapterList('9012');
      const chapters = Array.isArray(chapterResult) ? chapterResult : chapterResult.chapters;

      expect(chapters).toHaveLength(1);
      expect(chapters[0]).toMatchObject({
        id: '300001',
        url: 'https://comic.pixiv.net/viewer/stories/300001',
        locked: false,
      });
    });

    it('logs invariant error when duplicate chapter ids are returned with different URLs', async () => {
      const logger = await import('@/src/runtime/logger');

      mockRateLimitedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            episodes: [
              {
                state: 'readable',
                episode: {
                  id: 400001,
                  numbering_title: '第4話',
                  sub_title: '',
                  viewer_path: '/viewer/stories/400001',
                },
              },
              {
                state: 'unreadable',
                episode: {
                  id: 400001,
                  numbering_title: '第4話',
                  sub_title: '有料',
                  viewer_path: '/episodes/400001',
                },
              },
            ],
          },
        }),
      });

      const { pixivComicIntegration } = await import('@/src/site-integrations/pixiv-comic');
      const chapterResult = await pixivComicIntegration.background.series!.fetchChapterList('9012');
      const chapters = Array.isArray(chapterResult) ? chapterResult : chapterResult.chapters;

      expect(chapters).toHaveLength(1);
      expect(chapters[0].id).toBe('400001');
      expect(logger.default.error).toHaveBeenCalledWith(
        '[pixiv-comic] Duplicate chapter ids detected in fetchChapterList',
        expect.objectContaining({
          seriesId: '9012',
          duplicateChapterIds: ['400001'],
        })
      );
    });
  });
}
