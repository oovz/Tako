/**
 * @file shonenjumpplus-download-workflow.spec.ts
 * @description Phase-3 download-workflow coverage for the Shonen Jump+
 * integration.
 *
 * Exercises the pipeline end-to-end without live network:
 *
 *   series/episode page -> tab state -> episode-json script parsing
 *       -> pageStructure.pages[] -> cdn-ak-img.shonenjumpplus.com
 *       -> offscreen archive -> OPFS cbz
 *
 * Regression targets:
 * - `extractImageUrlsFromEpisodeJsonScript` (HTML attribute decoding).
 * - `rateLimitedFetchByUrlScope(chapter.url)` returning HTML with an
 *   embedded episode-json script (not a separate JSON endpoint).
 * - Image-descrambler short-circuit on 1x1 fixtures (tileWidth == 0
 *   branch in `descrambleGigaviewerImage`).
 */

import { test, expect } from './fixtures/extension';
import {
  getTabId,
  waitForTabSeriesTitle,
  waitForTabStateById,
} from './fixtures/state-helpers';
import { SHONENJUMPPLUS_BASE_URL } from './fixtures/test-domains';
import { ShonenJumpPlus } from './fixtures/mock-data';
import {
  assertTaskSucceeded,
  openOptionsPage,
  persistCustomModeDownloadSettings,
  seedCustomDirectoryHandle,
  startSingleChapterDownload,
  waitForCbzArtifact,
  waitForTerminalTask,
} from './fixtures/download-workflow-helpers';

test.describe('Shonen Jump+ download workflow (mocked)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('completes a single-chapter download through the episode-json pipeline', async ({ context, extensionId, page }) => {
    const series = ShonenJumpPlus.BASIC_SERIES.series;
    // Shonen Jump+ series URLs ARE episode URLs: the seriesId equals
    // the first episode id, so `/episode/{id}` doubles as the landing
    // page the content script reads to initialize the tab state.
    const seriesUrl = `${SHONENJUMPPLUS_BASE_URL}/episode/${series.seriesId}`;

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
        siteIntegrationId: 'shonenjumpplus',
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
