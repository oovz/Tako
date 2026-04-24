/**
 * @file manhuagui-download-workflow.spec.ts
 * @description Phase-3 download-workflow coverage for the Manhuagui
 * integration.
 *
 * This spec exercises the production chapter pipeline end-to-end without
 * live network:
 *
 *   series page -> tab state -> chapter viewer HTML (packed payload)
 *       -> config_*.js on cf.mhgui.com (picserv → host=`i`)
 *       -> i.hamreus.com image bytes -> offscreen archive -> OPFS cbz
 *
 * Regression targets:
 * - P.A.C.K.E.R. unpacker + `imgData` JSON parsing (chapter-viewer.ts).
 * - Reader-config fetch + host selection (reader-config.ts).
 * - Signed-URL construction (`?e=...&m=...`) for hamreus.com.
 * - Adult-gate cookie priming fix (covered by unit tests; this spec keeps
 *   the happy path green so regressions don't lurk behind the gate).
 */

import { test, expect } from './fixtures/extension';
import {
  getTabId,
  waitForTabSeriesTitle,
  waitForTabStateById,
} from './fixtures/state-helpers';
import { MANHUAGUI_BASE_URL } from './fixtures/test-domains';
import { Manhuagui } from './fixtures/mock-data';
import {
  assertTaskSucceeded,
  openOptionsPage,
  persistCustomModeDownloadSettings,
  seedCustomDirectoryHandle,
  startSingleChapterDownload,
  waitForCbzArtifact,
  waitForTerminalTask,
} from './fixtures/download-workflow-helpers';

test.describe('Manhuagui download workflow (mocked)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('completes a single-chapter download through the packed-payload pipeline', async ({ context, extensionId, page }) => {
    const series = Manhuagui.BASIC_SERIES.series;
    const seriesUrl = `${MANHUAGUI_BASE_URL}/comic/${series.seriesId}/`;

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
        siteIntegrationId: 'manhuagui',
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
