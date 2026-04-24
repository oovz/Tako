/**
 * @file mangadex-download-workflow.spec.ts
 * @description Phase-3 download-workflow coverage for the MangaDex
 * integration.
 *
 * Exercises the full pipeline end-to-end without live network:
 *
 *   series page -> tab state -> chapter-feed -> at-home server
 *                     -> image bytes -> offscreen archive -> OPFS cbz
 *
 * Assertions target the canonical success signals the live spec checks:
 * task reaches `completed`/`partial_success`, and at least one non-empty
 * `.cbz` artifact appears in the seeded OPFS directory. A regression in
 * MangaDex chapter-image URL resolution, at-home retry logic, or archive
 * assembly will flip this spec red before it reaches production.
 */

import { test, expect } from './fixtures/extension';
import {
  getTabId,
  waitForTabSeriesTitle,
  waitForTabStateById,
} from './fixtures/state-helpers';
import { MANGADEX_BASE_URL } from './fixtures/test-domains';
import { Mangadex } from './fixtures/mock-data';
import {
  assertTaskSucceeded,
  openOptionsPage,
  persistCustomModeDownloadSettings,
  seedCustomDirectoryHandle,
  seedMangadexSessionPreferences,
  startSingleChapterDownload,
  waitForCbzArtifact,
  waitForTerminalTask,
} from './fixtures/download-workflow-helpers';

test.describe('MangaDex download workflow (mocked)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('completes a single-chapter download to the custom OPFS folder', async ({ context, extensionId, page }) => {
    const series = Mangadex.BASIC_SERIES.series;
    const seriesUrl = `${MANGADEX_BASE_URL}/title/${series.seriesId}/hunter-x-hunter`;

    await page.goto(seriesUrl, { waitUntil: 'domcontentloaded' });
    const tabId = await getTabId(page, context);

    // Wait for content-script-driven tab state to populate so the download
    // message has a valid tab reference + chapter list to pick from.
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
      await seedMangadexSessionPreferences(optionsPage, series.seriesId);
      const seededDirectoryName = await seedCustomDirectoryHandle(optionsPage);
      await persistCustomModeDownloadSettings(optionsPage, {
        mangadex: {
          autoReadMangaDexSettings: true,
          imageQuality: 'data',
        },
      });

      const taskId = await startSingleChapterDownload(optionsPage, {
        sourceTabId: tabId,
        siteIntegrationId: 'mangadex',
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

      // Custom-mode downloads never use chrome.downloads, so
      // `lastSuccessfulDownloadId` stays undefined — this is also a
      // defensive check that we actually went through the OPFS path.
      expect(task.lastSuccessfulDownloadId).toBeUndefined();

      const files = await waitForCbzArtifact(optionsPage, seededDirectoryName);
      expect(files.some((file) => file.path.toLowerCase().endsWith('.cbz') && file.size > 0)).toBe(true);
    } finally {
      await optionsPage.close();
    }
  });
});
