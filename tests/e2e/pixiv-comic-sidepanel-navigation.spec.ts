import { test, expect } from './fixtures/extension';
import {
  getTabId,
  openSidepanelHarness,
  waitForTabSeriesTitle,
  waitForTabStateCleared,
} from './fixtures/state-helpers';
import { PIXIV_COMIC_BASE_URL } from './fixtures/test-domains';
import { PixivComic } from './fixtures/mock-data';

test.describe('Pixiv Comic side panel navigation workflows (mocked)', () => {
  test('front page -> work page initializes tab state', async ({ context, extensionId, page }) => {
    await page.goto(PIXIV_COMIC_BASE_URL, { waitUntil: 'domcontentloaded' });
    const tabId = await getTabId(page, context);

    const sp = await openSidepanelHarness(context, extensionId, page);
    await expect(sp.locator('#root')).toBeVisible();

    await page.bringToFront();

    const workUrl = `${PIXIV_COMIC_BASE_URL}/works/${PixivComic.BASIC_SERIES.series.seriesId}`;
    await page.goto(workUrl, { waitUntil: 'domcontentloaded' });

    await waitForTabSeriesTitle(context, tabId, PixivComic.BASIC_SERIES.series.seriesTitle);

    await sp.close();
  });

  test('work -> front page -> different work reinitializes tab state', async ({ context, extensionId, page }) => {
    const work1Url = `${PIXIV_COMIC_BASE_URL}/works/${PixivComic.BASIC_SERIES.series.seriesId}`;
    const work2Url = `${PIXIV_COMIC_BASE_URL}/works/${PixivComic.MINIMAL_SERIES.series.seriesId}`;

    await page.goto(work1Url, { waitUntil: 'domcontentloaded' });
    const tabId = await getTabId(page, context);

    const sp = await openSidepanelHarness(context, extensionId, page);
    await expect(sp.locator('#root')).toBeVisible();
    await page.bringToFront();

    await waitForTabSeriesTitle(context, tabId, PixivComic.BASIC_SERIES.series.seriesTitle);

    await page.goto(PIXIV_COMIC_BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForTabStateCleared(context, tabId);

    await page.goto(work2Url, { waitUntil: 'domcontentloaded' });
    await waitForTabSeriesTitle(context, tabId, PixivComic.MINIMAL_SERIES.series.seriesTitle);

    await sp.close();
  });
});
