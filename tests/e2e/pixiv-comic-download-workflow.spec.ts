/**
 * @file pixiv-comic-download-workflow.spec.ts
 * @description Phase-3 download-workflow coverage for the Pixiv Comic
 * integration.
 *
 * Exercises the full pipeline end-to-end without live network:
 *
 *   work page -> tab state -> buildId from homepage -> salt JSON
 *       -> read_v4 image URL list -> img-comic.pximg.net bytes
 *       -> offscreen archive -> OPFS cbz
 *
 * Regression targets:
 * - Next.js build-id parsing (`parseBuildId`) and salt fetch.
 * - `/api/app/episodes/{id}/read_v4` payload handling with flat
 *   `pages` array (no descramble key).
 * - Image download + archive assembly when no descramble key is set.
 */

import { test, expect } from './fixtures/extension';
import {
  getTabId,
  waitForTabSeriesTitle,
  waitForTabStateById,
} from './fixtures/state-helpers';
import { PIXIV_COMIC_BASE_URL } from './fixtures/test-domains';
import { PixivComic } from './fixtures/mock-data';
import {
  assertTaskSucceeded,
  openOptionsPage,
  persistCustomModeDownloadSettings,
  seedCustomDirectoryHandle,
  startSingleChapterDownload,
  waitForCbzArtifact,
  waitForTerminalTask,
} from './fixtures/download-workflow-helpers';

test.describe('Pixiv Comic download workflow (mocked)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('completes a single-chapter download through the read_v4 + pximg pipeline', async ({ context, extensionId, page }) => {
    const series = PixivComic.BASIC_SERIES.series;
    const seriesUrl = `${PIXIV_COMIC_BASE_URL}/works/${series.seriesId}`;

    await page.goto(seriesUrl, { waitUntil: 'domcontentloaded' });
    const tabId = await getTabId(page, context);

    await waitForTabSeriesTitle(context, tabId, series.seriesTitle);
    const tabState = await waitForTabStateById(
      page,
      context,
      tabId,
      (state) => Array.isArray(state.chapters) && state.chapters.length > 0,
    );

    const firstChapter = tabState.chapters.find((chapter) => chapter.locked !== true);
    if (!firstChapter) {
      throw new Error(`No downloadable chapter found for series ${series.seriesId}`);
    }

    const optionsPage = await openOptionsPage(context, extensionId);
    try {
      const seededDirectoryName = await seedCustomDirectoryHandle(optionsPage);
      await persistCustomModeDownloadSettings(optionsPage);

      const taskId = await startSingleChapterDownload(optionsPage, {
        sourceTabId: tabId,
        siteIntegrationId: 'pixiv-comic',
        mangaId: series.seriesId,
        seriesTitle: series.seriesTitle,
        chapter: {
          id: firstChapter.id,
          title: firstChapter.title,
          url: firstChapter.url,
          index: firstChapter.index,
          chapterLabel: firstChapter.chapterLabel,
          chapterNumber: firstChapter.chapterNumber,
          volumeLabel: firstChapter.volumeLabel,
          volumeNumber: firstChapter.volumeNumber,
          language: firstChapter.language,
        },
      });

      const task = await waitForTerminalTask(context, taskId);
      assertTaskSucceeded(task);
      expect(task.lastSuccessfulDownloadId).toBeUndefined();

      const files = await waitForCbzArtifact(optionsPage, seededDirectoryName);
      expect(files.some((file) => file.path.toLowerCase().endsWith('.cbz') && file.size > 0)).toBe(true);
    } finally {
      await optionsPage.close();
    }
  });
});
