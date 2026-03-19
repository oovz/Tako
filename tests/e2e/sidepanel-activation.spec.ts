import { test, expect } from './fixtures/extension';
import { getTabId, initializeTabViaAction, openSidepanelHarness } from './fixtures/state-helpers';
import { MANGADEX_TEST_SERIES_URL, buildExampleUrl } from './fixtures/test-domains';

async function getActionTitle(context: import('@playwright/test').BrowserContext, tabId: number): Promise<string> {
  const expectedName = 'Tako Manga Downloader'
  const isOurWorker = async (sw: import('@playwright/test').Worker): Promise<boolean> => {
    try {
      const name = await sw.evaluate(() => chrome.runtime.getManifest().name)
      return name === expectedName
    } catch {
      return false
    }
  }

  let worker: import('@playwright/test').Worker | undefined
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidates = context.serviceWorkers().filter((sw) => sw.url().startsWith('chrome-extension://'))
    for (const sw of candidates) {
      if (await isOurWorker(sw)) {
        worker = sw
        break
      }
    }
    if (worker) break

    try {
      await context.waitForEvent('serviceworker', {
        timeout: 1000,
        predicate: (sw) => sw.url().startsWith('chrome-extension://'),
      })
    } catch {
      void 0
    }
  }

  if (!worker) {
    throw new Error('Service worker not found')
  }
  return await worker.evaluate(async (id: number) => {
    try {
      return await chrome.action.getTitle({ tabId: id });
    } catch {
      return ''
    }
  }, tabId);
}

async function isActionEnabled(context: import('@playwright/test').BrowserContext, tabId: number): Promise<boolean> {
  const expectedName = 'Tako Manga Downloader'
  const isOurWorker = async (sw: import('@playwright/test').Worker): Promise<boolean> => {
    try {
      const name = await sw.evaluate(() => chrome.runtime.getManifest().name)
      return name === expectedName
    } catch {
      return false
    }
  }

  let worker: import('@playwright/test').Worker | undefined
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidates = context.serviceWorkers().filter((sw) => sw.url().startsWith('chrome-extension://'))
    for (const sw of candidates) {
      if (await isOurWorker(sw)) {
        worker = sw
        break
      }
    }
    if (worker) break

    try {
      await context.waitForEvent('serviceworker', {
        timeout: 1000,
        predicate: (sw) => sw.url().startsWith('chrome-extension://'),
      })
    } catch {
      void 0
    }
  }

  if (!worker) {
    throw new Error('Service worker not found')
  }

  return await worker.evaluate(async (id: number) => {
    try {
      return await chrome.action.isEnabled(id)
    } catch {
      return false
    }
  }, tabId)
}

async function waitForActionTitle(
  context: import('@playwright/test').BrowserContext,
  tabId: number,
  expectedSubstring: string,
  timeoutMs: number = 5000
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const title = await getActionTitle(context, tabId);
    if (title.includes(expectedSubstring)) {
      return title;
    }
    await context.pages()[0]?.waitForTimeout(100);
  }
  const finalTitle = await getActionTitle(context, tabId);
  throw new Error(`Timeout waiting for action title to include "${expectedSubstring}" (last title: "${finalTitle}")`);
}

async function waitForSidepanelSeries(
  page: import('@playwright/test').Page,
  seriesTitle: string,
  timeoutMs: number = 15000
): Promise<void> {
  await page.waitForFunction(
    async ({ title }) => {
      const result = await chrome.storage.session.get('activeTabContext');
      const state = result.activeTabContext as { seriesTitle?: string } | undefined;
      return state?.seriesTitle === title;
    },
    { title: seriesTitle },
    { timeout: timeoutMs }
  );
}

test.describe('Side Panel activation and enable/disable behavior', () => {
  test('opens side panel on supported series page and keeps the action enabled', async ({ context, extensionId, page }) => {
    // Navigate to a supported series page (mangadex)
    await page.goto(MANGADEX_TEST_SERIES_URL, { waitUntil: 'domcontentloaded' });

    const baseChapters = [
      { id: 'chapter-1', url: 'https://example.com/ch1', title: 'Chapter 1' },
      { id: 'chapter-2', url: 'https://example.com/ch2', title: 'Chapter 2' },
    ];

    const tabId = await initializeTabViaAction(
      page,
      context,
      extensionId,
      {
        siteIntegrationId: 'mangadex',
        mangaId: 'mangadex:db692d58-4b13-4174-ae8c-30c515c0689c',
        seriesTitle: 'Hunter x Hunter',
        chapters: baseChapters,
      },
      MANGADEX_TEST_SERIES_URL,
    );

    // The background should have enabled the action and set supported title
    const title = await waitForActionTitle(context, tabId, 'Supported');
    expect(title).toContain('Supported');
    await expect.poll(async () => isActionEnabled(context, tabId)).toBe(true)

    // Load sidepanel.html and assert UI renders with series-aware card for active tab
    const sp = await openSidepanelHarness(context, extensionId, page);
    await expect(sp.locator('#root')).toBeVisible();
    await waitForSidepanelSeries(sp, 'Hunter x Hunter');
    await expect(sp.getByText('Hunter x Hunter')).toBeVisible({ timeout: 10000 });
    // Series-aware card should be present with a "Select chapters" control
    await expect(sp.getByRole('button', { name: /Select chapters/i })).toBeVisible();
    await sp.close();
  });

  test('keeps action enabled on unsupported page and reports unsupported title', async ({ context, extensionId, page }) => {
    await page.goto(buildExampleUrl('/'), { waitUntil: 'domcontentloaded' });
    const tabId = await getTabId(page, context);

    const title = await waitForActionTitle(context, tabId, 'Unsupported');
    expect(title).toContain('Unsupported');
    await expect.poll(async () => isActionEnabled(context, tabId)).toBe(true)

    // Open Side Panel for this active unsupported tab and assert Command Center renders
    const sp = await openSidepanelHarness(context, extensionId, page);
    await expect(sp.locator('#root')).toBeVisible();
    // On unsupported pages, the series region shows a compact no-series guidance state
    await expect(sp.getByText(/No series detected/i)).toBeVisible();
    // The shared "Select chapters" entry point is still rendered as part of the Command Center
    await expect(sp.getByRole('button', { name: /Select chapters/i })).toBeVisible();
    await sp.close();
  });

  test('uses sidepanel.html as single entrypoint for supported and unsupported tabs', async ({ context, extensionId, page }) => {
    // Unsupported tab: example.com
    await page.goto(buildExampleUrl('/'), { waitUntil: 'domcontentloaded' });
    await getTabId(page, context);

    const spUnsupported = await openSidepanelHarness(context, extensionId, page);
    await expect(spUnsupported.locator('#root')).toBeVisible();
    await expect(spUnsupported.url()).toMatch(/\/sidepanel\.html$/);

    // Supported series tab: mangadex
    const supportedPage = await context.newPage();
    const baseChapters = [
      { id: 'chapter-1', url: 'https://example.com/ch1', title: 'Chapter 1' },
      { id: 'chapter-2', url: 'https://example.com/ch2', title: 'Chapter 2' },
    ];

    await initializeTabViaAction(
      supportedPage,
      context,
      extensionId,
      {
        siteIntegrationId: 'mangadex',
        mangaId: 'test-series-entrypoint',
        seriesTitle: 'EntryPoint Test Series',
        chapters: baseChapters,
      },
      MANGADEX_TEST_SERIES_URL,
    );

    const spSupported = await openSidepanelHarness(context, extensionId, supportedPage);
    await expect(spSupported.locator('#root')).toBeVisible();
    await waitForSidepanelSeries(spSupported, 'EntryPoint Test Series');
    await expect(spSupported.url()).toMatch(/\/sidepanel\.html$/);

    // Interactions within the Command Center (e.g., opening the chapter selector) must not navigate away from sidepanel.html
    await spSupported.getByRole('button', { name: /Select chapters/i }).click();
    await expect(spSupported.url()).toMatch(/\/sidepanel\.html$/);

    await spUnsupported.close();
    await spSupported.close();
    await supportedPage.close();
  });

  test('shows unsupported message on about:blank', async ({ context, extensionId }) => {
    // Navigate to about:blank
    const page = await context.newPage();
    await page.goto('about:blank');

    await getTabId(page, context);

    // Open Side Panel for this about:blank tab
    const sp = await openSidepanelHarness(context, extensionId, page);
    await expect(sp.locator('#root')).toBeVisible();

    // Should show no-series guidance for about:blank
    await expect(sp.getByText(/No series detected/i)).toBeVisible();

    await sp.close();
    await page.close();
  });

  test('handles page refresh on supported page', async ({ context, extensionId, page }) => {
    // Navigate to a supported series page
    await page.goto(MANGADEX_TEST_SERIES_URL, { waitUntil: 'domcontentloaded' });

    const baseChapters = [
      { id: 'chapter-1', url: 'https://example.com/ch1', title: 'Chapter 1' },
      { id: 'chapter-2', url: 'https://example.com/ch2', title: 'Chapter 2' },
    ];

    await initializeTabViaAction(
      page,
      context,
      extensionId,
      {
        siteIntegrationId: 'mangadex',
        mangaId: 'test-series-refresh',
        seriesTitle: 'Refresh Test Series',
        chapters: baseChapters,
      },
      MANGADEX_TEST_SERIES_URL,
    );

    // Open Side Panel and verify initial state
    const sp = await openSidepanelHarness(context, extensionId, page);
    await expect(sp.locator('#root')).toBeVisible();
    await waitForSidepanelSeries(sp, 'Refresh Test Series');
    await expect(sp.getByText('Refresh Test Series')).toBeVisible({ timeout: 10000 });
    await expect(sp.getByRole('button', { name: /Select chapters/i })).toBeVisible();

    // Refresh the main page
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Re-initialize tab state after refresh
    await initializeTabViaAction(
      page,
      context,
      extensionId,
      {
        siteIntegrationId: 'mangadex',
        mangaId: 'test-series-refresh',
        seriesTitle: 'Refresh Test Series',
        chapters: baseChapters,
      },
      MANGADEX_TEST_SERIES_URL,
    );

    // Wait for side panel to update after refresh - it should still work
    await expect(sp.getByRole('button', { name: /Select chapters/i })).toBeVisible({ timeout: 5000 });

    await sp.close();
  });

  test('updates side panel when switching between tabs', async ({ context, extensionId }) => {
    // Create an unsupported tab
    const unsupportedPage = await context.newPage();
    await unsupportedPage.goto(buildExampleUrl('/'), { waitUntil: 'domcontentloaded' });
    await getTabId(unsupportedPage, context);

    // Create a supported tab
    const supportedPage = await context.newPage();
    await supportedPage.goto(MANGADEX_TEST_SERIES_URL, { waitUntil: 'domcontentloaded' });

    const baseChapters = [
      { id: 'chapter-1', url: 'https://example.com/ch1', title: 'Chapter 1' },
    ];

    await initializeTabViaAction(
      supportedPage,
      context,
      extensionId,
      {
        siteIntegrationId: 'mangadex',
        mangaId: 'db692d58-4b13-4174-ae8c-30c515c0689c',
        seriesTitle: 'Hunter x Hunter',
        chapters: baseChapters,
      },
      MANGADEX_TEST_SERIES_URL,
    );

    await supportedPage.bringToFront();

    // Open side panel for supported tab
    const sp = await openSidepanelHarness(context, extensionId, supportedPage);
    await expect(sp.getByText('Hunter x Hunter')).toBeVisible({ timeout: 10000 });
    await expect(sp.getByRole('button', { name: /Select chapters/i })).toBeVisible();

    await unsupportedPage.bringToFront();

    // Open side panel for unsupported tab (simulating tab switch)
    const spUnsupported = await openSidepanelHarness(context, extensionId, unsupportedPage);
    await expect(spUnsupported.getByText(/No series detected/i)).toBeVisible();

    await sp.close();
    await spUnsupported.close();
    await supportedPage.close();
    await unsupportedPage.close();
  });

  test('shows disabled no-chapters button when active series has zero chapters', async ({ context, extensionId, page }) => {
    await page.goto(MANGADEX_TEST_SERIES_URL, { waitUntil: 'domcontentloaded' });

    await initializeTabViaAction(
      page,
      context,
      extensionId,
      {
        siteIntegrationId: 'mangadex',
        mangaId: 'test-series-no-chapters',
        seriesTitle: 'No Chapters Test Series',
        chapters: [],
      },
      MANGADEX_TEST_SERIES_URL,
    );

    const sp = await openSidepanelHarness(context, extensionId, page);
    await expect(sp.locator('#root')).toBeVisible();
    await waitForSidepanelSeries(sp, 'No Chapters Test Series');
    await expect(sp.getByText('No Chapters Test Series')).toBeVisible({ timeout: 10000 });
    await expect(sp.getByText(/No chapters found/i)).toBeVisible();

    const disabledNoChaptersButton = sp.getByRole('button', { name: /No chapters/i });
    await expect(disabledNoChaptersButton).toBeVisible();
    await expect(disabledNoChaptersButton).toBeDisabled();

    await sp.close();
  });
});
