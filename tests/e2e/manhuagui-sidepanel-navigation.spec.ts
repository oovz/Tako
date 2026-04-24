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
