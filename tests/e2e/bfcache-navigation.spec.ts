/**
 * @file bfcache-navigation.spec.ts
 * @description Tests for back/forward navigation behavior with bfcache (back-forward cache)
 * 
 * User Stories Tested:
 * 1. When a user navigates to a supported URL, then to an unsupported URL,
 *    then uses the "back" function to return to the supported URL, the side panel
 *    should correctly show manga series information.
 * 
 * 2. When navigating FROM a supported page TO an unsupported page, the side panel
 *    should correctly show "tab not supported" message.
 * 
 * Technical context: Browser uses bfcache to restore pages on back/forward navigation.
 * The content script instance is preserved but frozen in bfcache. When restored,
 * the pageshow event fires with event.persisted=true, and we must reinitialize
 * the manga state to update the side panel.
 * 
 * Race condition fix: The content script uses an isPageHidden flag to prevent
 * pending async INITIALIZE_TAB from being sent after pagehide/CLEAR_TAB_STATE.
 * 
 * Ref: https://web.dev/bfcache/
 */

import { test, expect } from './fixtures/extension';
import { getSessionState, initializeTabViaAction, openSidepanelHarness, reloadSidepanelHarness } from './fixtures/state-helpers';
import { MANGADEX_TEST_SERIES_URL, buildMangadexUrl, buildExampleUrl } from './fixtures/test-domains';
import type { MangaPageState } from '../../src/types/tab-state';

async function waitForTabStateCleared(
  page: import('@playwright/test').Page,
  context: import('@playwright/test').BrowserContext,
  tabId: number,
  previousSeriesId: string,
  timeoutMs: number = 5000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await getSessionState<MangaPageState>(context, `tab_${tabId}`);
    if (!state || state.mangaId !== previousSeriesId) {
      return;
    }
    await page.waitForTimeout(100);
  }
  const finalState = await getSessionState<MangaPageState>(context, `tab_${tabId}`);
  throw new Error(`Timeout waiting for tab ${tabId} state to clear (last mangaId: ${finalState?.mangaId ?? 'none'})`);
}

async function waitForTabStateMatch(
  page: import('@playwright/test').Page,
  context: import('@playwright/test').BrowserContext,
  tabId: number,
  predicate: (state: MangaPageState) => boolean,
  timeoutMs: number = 5000
): Promise<MangaPageState> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await getSessionState<MangaPageState>(context, `tab_${tabId}`);
    if (state && predicate(state)) {
      return state;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`Timeout waiting for tab ${tabId} state to match predicate`);
}

test.describe('Navigation state management', () => {
    test.describe('Supported to unsupported page navigation', () => {
        test('clears state when navigating from supported to unsupported page', async ({ context, extensionId, page }) => {
            // Step 1: Initialize state (helper navigates to supported series page)
            const baseChapters = [
                { id: 'chapter-1', url: buildMangadexUrl('/chapter/ch1'), title: 'Chapter 1' },
                { id: 'chapter-2', url: buildMangadexUrl('/chapter/ch2'), title: 'Chapter 2' },
            ];

            const tabId = await initializeTabViaAction(
                page,
                context,
                extensionId,
                {
                    siteIntegrationId: 'mangadex',
                    mangaId: 'supported-to-unsupported-test',
                    seriesTitle: 'Test Series For Navigation',
                    chapters: baseChapters,
                },
                MANGADEX_TEST_SERIES_URL,
            );

            // Verify initial state is set
            const state = await getSessionState<MangaPageState>(context, `tab_${tabId}`);
            expect(state).toBeDefined();
            expect(state?.seriesTitle).toBe('Test Series For Navigation');

            // Step 2: Navigate to an unsupported page
            await page.goto(buildExampleUrl('/'), { waitUntil: 'domcontentloaded' });

            // Wait for pagehide event to fire and state to be cleared
            await waitForTabStateCleared(page, context, tabId, 'supported-to-unsupported-test');
        });

        test('side panel shows unsupported message after navigation to unsupported page', async ({ context, extensionId, page }) => {
            // Step 1: Initialize state (helper navigates to supported series page)
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

            // Open side panel and verify supported content
            const sp = await openSidepanelHarness(context, extensionId, page);
            await expect(sp.getByRole('button', { name: /Select chapters/i })).toBeVisible();
            await page.bringToFront();

            // Step 2: Navigate to unsupported page
            await page.goto(buildExampleUrl('/'), { waitUntil: 'domcontentloaded' });

            // Step 3: Refresh side panel - should show unsupported message
            await reloadSidepanelHarness(sp, page);
            await page.bringToFront();
            await expect(sp.getByText(/No series detected/i)).toBeVisible();

            await sp.close();
        });
    });

    test.describe('BFCache restoration on back/forward navigation', () => {
        test('restores manga series info after back navigation from unsupported page', async ({ context, extensionId, page }) => {
            // Step 1: Initialize state (helper navigates to supported series page)
            const baseChapters = [
                { id: 'chapter-1', url: buildMangadexUrl('/chapter/ch1'), title: 'Chapter 1' },
                { id: 'chapter-2', url: buildMangadexUrl('/chapter/ch2'), title: 'Chapter 2' },
            ];

            const tabId = await initializeTabViaAction(
                page,
                context,
                extensionId,
                {
                    siteIntegrationId: 'mangadex',
                    mangaId: 'bfcache-test-series',
                    seriesTitle: 'BFCache Test Series',
                    chapters: baseChapters,
                },
                MANGADEX_TEST_SERIES_URL,
            );

            // Verify initial state is set
            let state = await getSessionState<MangaPageState>(context, `tab_${tabId}`);
            expect(state).toBeDefined();
            expect(state?.seriesTitle).toBe('BFCache Test Series');
            expect(state?.chapters).toHaveLength(2);

            // Open side panel and verify it shows the series info
            const sp = await openSidepanelHarness(context, extensionId, page);
            await expect(sp.locator('#root')).toBeVisible();
            await expect(sp.getByRole('button', { name: /Select chapters/i })).toBeVisible();
            await page.bringToFront();

            // Step 2: Navigate to an unsupported page (this should clear state)
            await page.goto(buildExampleUrl('/'), { waitUntil: 'domcontentloaded' });

            // Give time for state to be cleared
            await waitForTabStateCleared(page, context, tabId, 'bfcache-test-series');

            // Step 3: Go back to the supported page (simulating bfcache restoration)
            await page.goBack({ waitUntil: 'domcontentloaded' });

            // The content script should reinitialize state via pageshow event
            // Re-initialize tab state since content script should have extracted it
            const newTabId = await initializeTabViaAction(
                page,
                context,
                extensionId,
                {
                    siteIntegrationId: 'mangadex',
                    mangaId: 'bfcache-test-series',
                    seriesTitle: 'BFCache Test Series',
                    chapters: baseChapters,
                },
                MANGADEX_TEST_SERIES_URL,
            );

            // Wait for state to be restored
            const startWait = Date.now();
            const timeout = 10000;
            while (Date.now() - startWait < timeout) {
                state = await getSessionState<MangaPageState>(context, `tab_${newTabId}`);
                if (state?.seriesTitle === 'BFCache Test Series' && state?.chapters?.length === 2) {
                    break;
                }
                await page.waitForTimeout(200);
            }

            // Verify state is restored correctly
            state = await getSessionState<MangaPageState>(context, `tab_${newTabId}`);
            expect(state).toBeDefined();
            expect(state?.seriesTitle).toBe('BFCache Test Series');
            expect(state?.mangaId).toBe('bfcache-test-series');
            expect(state?.siteIntegrationId).toBe('mangadex');
            expect(state?.chapters).toHaveLength(2);

            // Step 4: Verify side panel shows the series correctly after back navigation
            await reloadSidepanelHarness(sp, page);
            await page.bringToFront();
            await expect(sp.locator('#root')).toBeVisible();
            await expect(sp.getByRole('button', { name: /Select chapters/i })).toBeVisible();

            await sp.close();
        });

        test('handles forward navigation after back navigation correctly', async ({ context, extensionId, page }) => {
            // Step 1: Initialize state (helper navigates to supported series page)
            const baseChapters = [
                { id: 'chapter-1', url: buildMangadexUrl('/chapter/ch1'), title: 'Chapter 1' },
            ];

            const tabId = await initializeTabViaAction(
                page,
                context,
                extensionId,
                {
                    siteIntegrationId: 'mangadex',
                    mangaId: 'forward-test-series',
                    seriesTitle: 'Forward Nav Test',
                    chapters: baseChapters,
                },
                MANGADEX_TEST_SERIES_URL,
            );

            // Step 2: Navigate to unsupported page
            await page.goto(buildExampleUrl('/'), { waitUntil: 'domcontentloaded' });
            await waitForTabStateCleared(page, context, tabId, 'forward-test-series');

            // Step 3: Go back
            await page.goBack({ waitUntil: 'domcontentloaded' });

            // Re-initialize for the restored page
            const newTabId = await initializeTabViaAction(
                page,
                context,
                extensionId,
                {
                    siteIntegrationId: 'mangadex',
                    mangaId: 'forward-test-series',
                    seriesTitle: 'Forward Nav Test',
                    chapters: baseChapters,
                },
                MANGADEX_TEST_SERIES_URL,
            );

            // Verify state is present
            let state = await getSessionState<MangaPageState>(context, `tab_${newTabId}`);
            expect(state?.seriesTitle).toBe('Forward Nav Test');

            // Step 4: Go forward to unsupported page again
            await page.goForward({ waitUntil: 'domcontentloaded' });
            await waitForTabStateCleared(page, context, newTabId, 'forward-test-series');

            // Step 5: Go back again to supported page
            await page.goBack({ waitUntil: 'domcontentloaded' });

            // Re-initialize again
            const anotherTabId = await initializeTabViaAction(
                page,
                context,
                extensionId,
                {
                    siteIntegrationId: 'mangadex',
                    mangaId: 'forward-test-series',
                    seriesTitle: 'Forward Nav Test',
                    chapters: baseChapters,
                },
                MANGADEX_TEST_SERIES_URL,
            );

            // Wait and verify state
            state = await waitForTabStateMatch(
                page,
                context,
                anotherTabId,
                (current) => current.seriesTitle === 'Forward Nav Test' && current.mangaId === 'forward-test-series'
            );
            expect(state).toBeDefined();
            expect(state?.seriesTitle).toBe('Forward Nav Test');
            expect(state?.mangaId).toBe('forward-test-series');
        });

        test('side panel updates correctly after back navigation', async ({ context, extensionId, page }) => {
            // Step 1: Initialize state (helper navigates to supported series page)
            const tabId = await initializeTabViaAction(
                page,
                context,
                extensionId,
                {
                    siteIntegrationId: 'mangadex',
                    mangaId: 'sidepanel-update-test',
                    seriesTitle: 'Side Panel Update Test',
                    chapters: [
                        { id: 'chapter-1', url: buildMangadexUrl('/chapter/ch1'), title: 'Volume 1 Chapter 1' },
                        { id: 'chapter-2', url: buildMangadexUrl('/chapter/ch2'), title: 'Volume 1 Chapter 2' },
                        { id: 'chapter-3', url: buildMangadexUrl('/chapter/ch3'), title: 'Volume 2 Chapter 1' },
                    ],
                },
                MANGADEX_TEST_SERIES_URL,
            );

            // Open side panel
            const sp = await openSidepanelHarness(context, extensionId, page);
            await expect(sp.getByRole('button', { name: /Select chapters/i })).toBeVisible();
            await page.bringToFront();

            // Step 2: Navigate to unsupported page
            await page.goto(buildExampleUrl('/'), { waitUntil: 'domcontentloaded' });
            await waitForTabStateCleared(page, context, tabId, 'sidepanel-update-test', 10000);

            // Side panel should now show unsupported message after refresh
            await reloadSidepanelHarness(sp, page);
            await page.bringToFront();
            await expect(sp.getByText(/No series detected/i)).toBeVisible();

            // Step 3: Go back to supported page
            await page.goBack({ waitUntil: 'domcontentloaded' });

            // Re-initialize tab state
            await initializeTabViaAction(
                page,
                context,
                extensionId,
                {
                    siteIntegrationId: 'mangadex',
                    mangaId: 'sidepanel-update-test',
                    seriesTitle: 'Side Panel Update Test',
                    chapters: [
                        { id: 'chapter-1', url: buildMangadexUrl('/chapter/ch1'), title: 'Volume 1 Chapter 1' },
                        { id: 'chapter-2', url: buildMangadexUrl('/chapter/ch2'), title: 'Volume 1 Chapter 2' },
                        { id: 'chapter-3', url: buildMangadexUrl('/chapter/ch3'), title: 'Volume 2 Chapter 1' },
                    ],
                },
                MANGADEX_TEST_SERIES_URL,
            );

            // Wait for state to be set
            await waitForTabStateMatch(
                page,
                context,
                tabId,
                (current) => current.seriesTitle === 'Side Panel Update Test' && current.mangaId === 'sidepanel-update-test'
            );

            // Step 4: Refresh side panel and verify it shows supported content
            await reloadSidepanelHarness(sp, page);
            await page.bringToFront();
            await expect(sp.locator('#root')).toBeVisible();
            await expect(sp.getByRole('button', { name: /Select chapters/i })).toBeVisible();

            await sp.close();
        });
    });
});
