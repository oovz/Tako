/**
 * @file api-fixtures.ts
 * @description Pixiv Comic API response builders for e2e mocks.
 *
 * Mirrors the response shapes declared in
 * `@/src/site-integrations/pixiv-comic/shared.ts` (`PixivWorkV5Response`,
 * `PixivEpisodesV2Response`). Keep this file synchronized with those types;
 * if Pixiv's API shape changes, unit tests will catch the drift first, then
 * the Layer-1 e2e specs, then live tests.
 */

import { BASIC_CHAPTERS, SMALL_SERIES } from './chapter-data';
import { BASIC_SERIES, MINIMAL_SERIES } from './series-data';

export const PIXIV_COMIC_API_DOMAIN = 'comic.pixiv.net';

function coverUrlFor(seriesId: string, explicit?: string): string {
  return explicit || `https://img-comic.test/works/${seriesId}/cover_main_big.jpg`;
}

/**
 * Build a `GET /api/app/works/v5/{workId}` response body.
 */
export function buildPixivWorkV5Response(workId: string): Record<string, unknown> {
  const fixture = workId === BASIC_SERIES.series.seriesId
    ? BASIC_SERIES.series
    : workId === MINIMAL_SERIES.series.seriesId
      ? MINIMAL_SERIES.series
      : { siteId: 'pixiv-comic', seriesId: workId, seriesTitle: `Work ${workId}` };

  return {
    data: {
      official_work: {
        id: Number(workId) || 0,
        name: fixture.seriesTitle,
        author: typeof fixture.author === 'string' ? fixture.author : '',
        description: typeof fixture.description === 'string' ? fixture.description : '',
        image: {
          main: coverUrlFor(workId, typeof fixture.coverUrl === 'string' ? fixture.coverUrl : undefined),
          main_big: coverUrlFor(workId, typeof fixture.coverUrl === 'string' ? fixture.coverUrl : undefined),
          thumbnail: coverUrlFor(workId, typeof fixture.coverUrl === 'string' ? fixture.coverUrl : undefined),
        },
      },
    },
  };
}

/**
 * Build a `GET /api/app/works/{workId}/episodes/v2` response body.
 */
export function buildPixivEpisodesV2Response(workId: string): Record<string, unknown> {
  const dataset = workId === BASIC_SERIES.series.seriesId
    ? BASIC_CHAPTERS.chapters
    : workId === MINIMAL_SERIES.series.seriesId
      ? SMALL_SERIES.chapters
      : [];

  const episodes = dataset.map((chapter, index) => ({
    state: 'readable',
    episode: {
      id: Number(chapter.id) || index + 1,
      numbering_title: `第${chapter.chapterNumber ?? index + 1}話`,
      sub_title: chapter.title,
      viewer_path: `/viewer/stories/${chapter.id}`,
      state: 'readable',
    },
  }));

  return { data: { episodes } };
}
