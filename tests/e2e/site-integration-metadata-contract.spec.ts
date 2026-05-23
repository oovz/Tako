import { test, expect } from './fixtures/extension';
import {
  getTabId,
  waitForTabSeriesTitle,
  waitForTabStateById,
} from './fixtures/state-helpers';
import {
  MANGADEX_BASE_URL,
  MANHUAGUI_BASE_URL,
  PIXIV_COMIC_BASE_URL,
  SHONENJUMPPLUS_BASE_URL,
} from './fixtures/test-domains';
import { Mangadex, Manhuagui, PixivComic, ShonenJumpPlus } from './fixtures/mock-data';

test.describe('Site integration chapter metadata contracts (mocked)', () => {
  test('MangaDex keeps chapter titles and API volume fields separate', async ({ context, page }) => {
    const series = Mangadex.BASIC_SERIES.series;
    await page.goto(`${MANGADEX_BASE_URL}/title/${series.seriesId}/hunter-x-hunter`, { waitUntil: 'domcontentloaded' });
    const tabId = await getTabId(page, context);

    await waitForTabSeriesTitle(context, tabId, series.seriesTitle);
    const state = await waitForTabStateById(
      page,
      context,
      tabId,
      (candidate) => Array.isArray(candidate.chapters) && candidate.chapters.length > 0,
    );

    const firstChapter = state.chapters.find((chapter) => chapter.id === 'afaebc64-83df-4f11-b2b0-5ef4fcc8144c');
    expect(firstChapter).toMatchObject({
      title: 'The Day of Departure',
      chapterLabel: '1',
      chapterNumber: 1,
      volumeId: 'mangadex-volume-1',
      volumeLabel: 'Vol. 1',
      volumeNumber: 1,
    });
    expect(state.volumes).toEqual(expect.arrayContaining([
      { id: 'mangadex-volume-1', title: 'Vol. 1', label: 'Vol. 1' },
      { id: 'mangadex-volume-2', title: 'Vol. 2', label: 'Vol. 2' },
    ]));
  });

  test('Pixiv Comic composes numbering and subtitle once without synthetic volumes', async ({ context, page }) => {
    const series = PixivComic.BASIC_SERIES.series;
    await page.goto(`${PIXIV_COMIC_BASE_URL}/works/${series.seriesId}`, { waitUntil: 'domcontentloaded' });
    const tabId = await getTabId(page, context);

    await waitForTabSeriesTitle(context, tabId, series.seriesTitle);
    const state = await waitForTabStateById(
      page,
      context,
      tabId,
      (candidate) => Array.isArray(candidate.chapters) && candidate.chapters.length > 0,
    );

    const firstChapter = state.chapters.find((chapter) => chapter.id === '70001');
    expect(firstChapter).toMatchObject({
      title: '第1話 出発',
      chapterLabel: '第1話',
      chapterNumber: 1,
    });
    expect(firstChapter?.volumeId).toBeUndefined();
    expect(firstChapter?.volumeLabel).toBeUndefined();
    expect(firstChapter?.volumeNumber).toBeUndefined();
    expect(state.volumes).toEqual([]);
  });

  test('Shonen Jump+ uses pagination API episode titles without volume metadata', async ({ context, page }) => {
    const series = ShonenJumpPlus.BASIC_SERIES.series;
    await page.goto(`${SHONENJUMPPLUS_BASE_URL}/episode/${series.seriesId}`, { waitUntil: 'domcontentloaded' });
    const tabId = await getTabId(page, context);

    await waitForTabSeriesTitle(context, tabId, series.seriesTitle);
    const state = await waitForTabStateById(
      page,
      context,
      tabId,
      (candidate) => Array.isArray(candidate.chapters) && candidate.chapters.length > 0,
    );

    const firstEpisode = state.chapters.find((chapter) => chapter.id === series.seriesId);
    expect(firstEpisode).toMatchObject({
      title: '第1話',
      chapterLabel: '第1話',
      chapterNumber: 1,
    });
    expect(firstEpisode?.volumeId).toBeUndefined();
    expect(firstEpisode?.volumeLabel).toBeUndefined();
    expect(firstEpisode?.volumeNumber).toBeUndefined();
    expect(state.volumes).toEqual([]);
  });

  test('Manhuagui preserves category headings as volumes and anchor titles as chapter titles', async ({ context, page }) => {
    const series = Manhuagui.KIMETSU_SERIES.series;
    await page.goto(`${MANHUAGUI_BASE_URL}/comic/${series.seriesId}/`, { waitUntil: 'domcontentloaded' });
    const tabId = await getTabId(page, context);

    await waitForTabSeriesTitle(context, tabId, series.seriesTitle);
    const state = await waitForTabStateById(
      page,
      context,
      tabId,
      (candidate) => Array.isArray(candidate.chapters) && candidate.chapters.length > 0,
    );

    expect(state.volumes).toEqual([
      { id: 'manhuagui-volume-1', title: '单行本', label: '单行本' },
      { id: 'manhuagui-volume-2', title: '单话', label: '单话' },
      { id: 'manhuagui-volume-3', title: '番外篇', label: '番外篇' },
    ]);

    expect(state.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      volumeId: chapter.volumeId,
      volumeLabel: chapter.volumeLabel,
      volumeNumber: chapter.volumeNumber,
    }))).toEqual([
      {
        id: '585094',
        title: '第01卷',
        volumeId: 'manhuagui-volume-1',
        volumeLabel: '单行本',
        volumeNumber: undefined,
      },
      {
        id: '219425',
        title: '第01回',
        volumeId: 'manhuagui-volume-2',
        volumeLabel: '单话',
        volumeNumber: undefined,
      },
      {
        id: '494877',
        title: '20卷附录',
        volumeId: 'manhuagui-volume-3',
        volumeLabel: '番外篇',
        volumeNumber: undefined,
      },
    ]);
  });
});
