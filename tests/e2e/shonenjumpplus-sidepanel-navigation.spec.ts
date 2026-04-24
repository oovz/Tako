import { test, expect } from './fixtures/extension';
import {
  getTabId,
  openSidepanelHarness,
  waitForTabSeriesTitle,
  waitForTabStateCleared,
} from './fixtures/state-helpers';
import { SHONENJUMPPLUS_BASE_URL } from './fixtures/test-domains';
import { ShonenJumpPlus } from './fixtures/mock-data';

test.describe('Shonen Jump+ side panel navigation workflows (mocked)', () => {
  test('front page -> episode page initializes tab state', async ({ context, extensionId, page }) => {
    await page.goto(SHONENJUMPPLUS_BASE_URL, { waitUntil: 'domcontentloaded' });
    const tabId = await getTabId(page, context);

    const sp = await openSidepanelHarness(context, extensionId, page);
    await expect(sp.locator('#root')).toBeVisible();

    await page.bringToFront();

    const episodeUrl = `${SHONENJUMPPLUS_BASE_URL}/episode/${ShonenJumpPlus.BASIC_SERIES.series.seriesId}`;
    await page.goto(episodeUrl, { waitUntil: 'domcontentloaded' });

    await waitForTabSeriesTitle(context, tabId, ShonenJumpPlus.BASIC_SERIES.series.seriesTitle);

    await sp.close();
  });

  test('episode -> front page -> different episode reinitializes tab state', async ({ context, extensionId, page }) => {
    const episode1Url = `${SHONENJUMPPLUS_BASE_URL}/episode/${ShonenJumpPlus.BASIC_SERIES.series.seriesId}`;
    const episode2Url = `${SHONENJUMPPLUS_BASE_URL}/episode/${ShonenJumpPlus.MINIMAL_SERIES.series.seriesId}`;

    await page.goto(episode1Url, { waitUntil: 'domcontentloaded' });
    const tabId = await getTabId(page, context);

    const sp = await openSidepanelHarness(context, extensionId, page);
    await expect(sp.locator('#root')).toBeVisible();
    await page.bringToFront();

    await waitForTabSeriesTitle(context, tabId, ShonenJumpPlus.BASIC_SERIES.series.seriesTitle);

    await page.goto(SHONENJUMPPLUS_BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForTabStateCleared(context, tabId);

    await page.goto(episode2Url, { waitUntil: 'domcontentloaded' });
    await waitForTabSeriesTitle(context, tabId, ShonenJumpPlus.MINIMAL_SERIES.series.seriesTitle);

    await sp.close();
  });
});
