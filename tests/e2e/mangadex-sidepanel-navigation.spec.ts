import { test, expect } from './fixtures/extension';
import { getSessionState, getTabId, openSidepanelHarness } from './fixtures/state-helpers';
import { MANGADEX_BASE_URL } from './fixtures/test-domains';
import { Mangadex } from './fixtures/mock-data';

async function waitForTabSeriesTitle(
  context: import('@playwright/test').BrowserContext,
  tabId: number,
  expectedTitle: string,
  timeoutMs: number = 15000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await getSessionState<{ seriesTitle?: string; seriesId?: string; siteId?: string }>(context, `tab_${tabId}`);
    if (state?.seriesTitle === expectedTitle) return;
    await context.pages()[0]?.waitForTimeout(150);
  }

  const finalState = await getSessionState(context, `tab_${tabId}`);
  throw new Error(`Timeout waiting for tab_${tabId}.seriesTitle == "${expectedTitle}" (last state: ${JSON.stringify(finalState)})`);
}

async function waitForTabStateCleared(
  context: import('@playwright/test').BrowserContext,
  tabId: number,
  timeoutMs: number = 15000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await getSessionState(context, `tab_${tabId}`);
    if (!state) return;
    await context.pages()[0]?.waitForTimeout(150);
  }

  const finalState = await getSessionState(context, `tab_${tabId}`);
  throw new Error(`Timeout waiting for tab_${tabId} to clear (last state: ${JSON.stringify(finalState)})`);
}

test.describe('MangaDex side panel navigation workflows (mocked)', () => {
  test('front page -> series page initializes tab state', async ({ context, extensionId, page }) => {
    await page.goto(MANGADEX_BASE_URL, { waitUntil: 'domcontentloaded' });
    const tabId = await getTabId(page, context);

    const sp = await openSidepanelHarness(context, extensionId, page);
    await expect(sp.locator('#root')).toBeVisible();

    // Keep the manga tab active so the sidepanel follows it (Playwright opens extension pages as tabs).
    await page.bringToFront();

    const seriesUrl = `${MANGADEX_BASE_URL}/title/${Mangadex.BASIC_SERIES.series.seriesId}/hunter-x-hunter`;
    await page.goto(seriesUrl, { waitUntil: 'domcontentloaded' });

    await waitForTabSeriesTitle(context, tabId, 'Hunter x Hunter');

    await sp.close();
  });

  test('series -> front page -> series (new) reinitializes to new series state', async ({ context, extensionId, page }) => {
    const series1Url = `${MANGADEX_BASE_URL}/title/${Mangadex.BASIC_SERIES.series.seriesId}/hunter-x-hunter`;
    const series2Url = `${MANGADEX_BASE_URL}/title/${Mangadex.MINIMAL_SERIES.series.seriesId}/hunter-x-hunter-official-colored`;

    await page.goto(series1Url, { waitUntil: 'domcontentloaded' });
    const tabId = await getTabId(page, context);

    const sp = await openSidepanelHarness(context, extensionId, page);
    await expect(sp.locator('#root')).toBeVisible();

    await page.bringToFront();

    await waitForTabSeriesTitle(context, tabId, 'Hunter x Hunter');

    await page.goto(MANGADEX_BASE_URL, { waitUntil: 'domcontentloaded' });

    // Unsupported page should clear the previous series state.
    await waitForTabStateCleared(context, tabId);

    await page.goto(series2Url, { waitUntil: 'domcontentloaded' });

    await waitForTabSeriesTitle(context, tabId, 'Hunter x Hunter (Official Colored)');

    await sp.close();
  });

  test('SPA: series -> front page -> series (new) via history.pushState requires refresh before new tab state appears', async ({ context, extensionId, page }) => {
    const series1Url = `${MANGADEX_BASE_URL}/title/${Mangadex.BASIC_SERIES.series.seriesId}/hunter-x-hunter`;
    const series2Path = `/title/${Mangadex.MINIMAL_SERIES.series.seriesId}/hunter-x-hunter-official-colored`;

    await page.goto(series1Url, { waitUntil: 'domcontentloaded' });
    const tabId = await getTabId(page, context);

    const sp = await openSidepanelHarness(context, extensionId, page);
    await expect(sp.locator('#root')).toBeVisible();

    await page.bringToFront();
    await waitForTabSeriesTitle(context, tabId, 'Hunter x Hunter');

    // Simulate SPA navigation to homepage (unsupported)
    await page.evaluate(() => {
      history.pushState({}, '', '/');
    });

    await waitForTabStateCleared(context, tabId);

    // Simulate SPA navigation to a new supported title
    await page.evaluate((path) => {
      history.pushState({}, '', path);
    }, series2Path);

    await waitForTabStateCleared(context, tabId);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForTabSeriesTitle(context, tabId, 'Hunter x Hunter (Official Colored)');

    await sp.close();
  });
});
