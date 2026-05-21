import { expect, type BrowserContext } from '@playwright/test';
import { test } from './fixtures/extension';
import {
  getSessionState,
  initializeTabViaAction,
  openSidepanelHarness,
  reloadSidepanelHarness,
} from './fixtures/state-helpers';
import { MANGADEX_TEST_SERIES_URL, buildExampleUrl, buildMangadexUrl } from './fixtures/test-domains';
import type { MangaPageState } from '../../src/types/tab-state';

async function waitForTabStateCleared(
  context: BrowserContext,
  tabId: number,
  previousSeriesId: string,
): Promise<void> {
  await expect.poll(async () => {
    const state = await getSessionState<MangaPageState>(context, `tab_${tabId}`);
    return !state || state.mangaId !== previousSeriesId;
  }).toBe(true);
}

test.describe('Navigation state management', () => {
  test('clears state when navigating from a supported page to an unsupported page', async ({ context, extensionId, page }) => {
    const tabId = await initializeTabViaAction(
      page,
      context,
      extensionId,
      {
        siteIntegrationId: 'mangadex',
        mangaId: 'supported-to-unsupported-test',
        seriesTitle: 'Test Series For Navigation',
        chapters: [
          { id: 'chapter-1', url: buildMangadexUrl('/chapter/ch1'), title: 'Chapter 1' },
          { id: 'chapter-2', url: buildMangadexUrl('/chapter/ch2'), title: 'Chapter 2' },
        ],
      },
      MANGADEX_TEST_SERIES_URL,
    );

    await expect.poll(async () => {
      const state = await getSessionState<MangaPageState>(context, `tab_${tabId}`);
      return state?.seriesTitle;
    }).toBe('Test Series For Navigation');

    await page.goto(buildExampleUrl('/'), { waitUntil: 'domcontentloaded' });

    await waitForTabStateCleared(context, tabId, 'supported-to-unsupported-test');
  });

  test('side panel shows unsupported state after navigating away from a supported page', async ({ context, extensionId, page }) => {
    await initializeTabViaAction(
      page,
      context,
      extensionId,
      {
        siteIntegrationId: 'mangadex',
        mangaId: 'sidepanel-unsupported-test',
        seriesTitle: 'Side Panel Unsupported Test',
        chapters: [{ id: 'chapter-1', url: buildMangadexUrl('/chapter/ch1'), title: 'Chapter 1' }],
      },
      MANGADEX_TEST_SERIES_URL,
    );

    const sidepanel = await openSidepanelHarness(context, extensionId, page);
    await expect(sidepanel.getByRole('button', { name: /Select chapters/i })).toBeVisible();
    await page.bringToFront();

    await page.goto(buildExampleUrl('/'), { waitUntil: 'domcontentloaded' });

    await reloadSidepanelHarness(sidepanel, page);
    await page.bringToFront();
    await expect(sidepanel.getByText(/No series detected/i)).toBeVisible();

    await sidepanel.close();
  });
});
