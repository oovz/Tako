import { test, expect } from './fixtures/extension';
import {
  getSessionState,
  getTabId,
  openSidepanelHarness,
  waitForTabSeriesTitle,
  waitForTabStateCleared,
} from './fixtures/state-helpers';
import { MANHUAGUI_BASE_URL } from './fixtures/test-domains';
import { Manhuagui } from './fixtures/mock-data';

test.describe('Manhuagui side panel navigation workflows (mocked)', () => {
  test('front page -> series page initializes tab state', async ({ context, extensionId, page }) => {
    await page.goto(MANHUAGUI_BASE_URL, { waitUntil: 'domcontentloaded' });
    const tabId = await getTabId(page, context);

    const sp = await openSidepanelHarness(context, extensionId, page);
    await expect(sp.locator('#root')).toBeVisible();

    await page.bringToFront();

    const seriesUrl = `${MANHUAGUI_BASE_URL}/comic/${Manhuagui.BASIC_SERIES.series.seriesId}/`;
    await page.goto(seriesUrl, { waitUntil: 'domcontentloaded' });

    await waitForTabSeriesTitle(context, tabId, Manhuagui.BASIC_SERIES.series.seriesTitle);

    await sp.close();
  });

  test('adult-gated series resolves chapter list via __VIEWSTATE fallback', async ({ context, extensionId, page }) => {
    const seriesUrl = `${MANHUAGUI_BASE_URL}/comic/${Manhuagui.ADULT_SERIES.series.seriesId}/`;

    await page.goto(seriesUrl, { waitUntil: 'domcontentloaded' });
    const tabId = await getTabId(page, context);

    const sp = await openSidepanelHarness(context, extensionId, page);
    await expect(sp.locator('#root')).toBeVisible();
    await page.bringToFront();

    await waitForTabSeriesTitle(context, tabId, Manhuagui.ADULT_SERIES.series.seriesTitle);

    // The adult-gate fixture ships two chapters in the lz-string-compressed
    // __VIEWSTATE. Verify both surface in the projected chapter list so a
    // regression in `resolveAdultChapterDocument` trips this spec.
    const state = await getSessionState<{ chapters?: Array<{ id?: string }> }>(context, `tab_${tabId}`);
    const chapterIds = (state?.chapters ?? []).map((chapter) => chapter.id).filter((id): id is string => typeof id === 'string');
    expect(chapterIds).toEqual(expect.arrayContaining(['700001', '700002']));

    await sp.close();
  });

  test('category headings render as volume labels in the chapter selector', async ({ context, extensionId, page }) => {
    const seriesUrl = `${MANHUAGUI_BASE_URL}/comic/${Manhuagui.CATEGORY_SERIES.series.seriesId}/`;

    await page.goto(seriesUrl, { waitUntil: 'domcontentloaded' });
    const tabId = await getTabId(page, context);

    const sp = await openSidepanelHarness(context, extensionId, page);
    await expect(sp.locator('#root')).toBeVisible();
    await page.bringToFront();

    await waitForTabSeriesTitle(context, tabId, Manhuagui.CATEGORY_SERIES.series.seriesTitle);

    const state = await getSessionState<{
      volumes?: Array<{ id?: string; title?: string; label?: string }>;
      chapters?: Array<{ id?: string; volumeId?: string; volumeLabel?: string; volumeNumber?: number }>;
    }>(context, `tab_${tabId}`);
    expect(state?.volumes).toEqual([
      { id: 'manhuagui-volume-1', title: '单行本', label: '单行本' },
      { id: 'manhuagui-volume-2', title: '番外篇', label: '番外篇' },
      { id: 'manhuagui-volume-3', title: '单话', label: '单话' },
    ]);
    expect(state?.chapters?.map((chapter) => ({
      id: chapter.id,
      volumeId: chapter.volumeId,
      volumeLabel: chapter.volumeLabel,
      volumeNumber: chapter.volumeNumber,
    }))).toEqual(expect.arrayContaining([
      { id: '378325', volumeId: 'manhuagui-volume-1', volumeLabel: '单行本', volumeNumber: undefined },
      { id: '363932', volumeId: 'manhuagui-volume-2', volumeLabel: '番外篇', volumeNumber: undefined },
      { id: '357842', volumeId: 'manhuagui-volume-3', volumeLabel: '单话', volumeNumber: undefined },
    ]));

    await sp.getByRole('button', { name: /Select Chapters/i }).click();
    const volumeRows = sp.locator('[data-testid="inline-item"][data-kind="volume"]');
    await expect(volumeRows).toHaveCount(3);
    await expect(volumeRows).toContainText(['单行本', '番外篇', '单话']);
    await expect(volumeRows).not.toContainText(['Volume 1', 'Volume 2', 'Volume 3']);

    await sp.close();
  });

  test('series -> front page -> different series reinitializes tab state', async ({ context, extensionId, page }) => {
    const series1Url = `${MANHUAGUI_BASE_URL}/comic/${Manhuagui.BASIC_SERIES.series.seriesId}/`;
    const series2Url = `${MANHUAGUI_BASE_URL}/comic/${Manhuagui.MINIMAL_SERIES.series.seriesId}/`;

    await page.goto(series1Url, { waitUntil: 'domcontentloaded' });
    const tabId = await getTabId(page, context);

    const sp = await openSidepanelHarness(context, extensionId, page);
    await expect(sp.locator('#root')).toBeVisible();
    await page.bringToFront();

    await waitForTabSeriesTitle(context, tabId, Manhuagui.BASIC_SERIES.series.seriesTitle);

    await page.goto(MANHUAGUI_BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForTabStateCleared(context, tabId);

    await page.goto(series2Url, { waitUntil: 'domcontentloaded' });
    await waitForTabSeriesTitle(context, tabId, Manhuagui.MINIMAL_SERIES.series.seriesTitle);

    await sp.close();
  });
});
