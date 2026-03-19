import { test, expect } from '../e2e/fixtures/extension';
import { getSessionState, getTabId, openSidepanelHarness } from '../e2e/fixtures/state-helpers';
import { LIVE_MANGADEX_REFERENCE_URL, buildExampleUrl } from '../e2e/fixtures/test-domains';

interface LiveTabState {
  siteIntegrationId?: string;
  mangaId?: string;
  seriesTitle?: string;
  chapters?: unknown[];
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function waitForLiveTabState(
  context: import('@playwright/test').BrowserContext,
  tabId: number,
  timeoutMs: number = 90_000,
): Promise<LiveTabState> {
  const start = Date.now();
  let lastState: LiveTabState | undefined;

  while (Date.now() - start < timeoutMs) {
    const state = await getSessionState<LiveTabState>(context, `tab_${tabId}`);
    lastState = state;

    const hasSeries = typeof state?.seriesTitle === 'string' && state.seriesTitle.length > 0;
    const hasSeriesId = typeof state?.mangaId === 'string' && state.mangaId.length > 0;
    const isMangadex = state?.siteIntegrationId === 'mangadex';

    if (isMangadex && hasSeries && hasSeriesId) {
      return state;
    }

    await context.pages()[0]?.waitForTimeout(500);
  }

  throw new Error(
    `Timed out waiting for live MangaDex state in tab_${tabId}. Last state: ${JSON.stringify(lastState)}`,
  );
}

test.describe('Live side panel context', () => {
  test('renders live MangaDex series context in side panel', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(LIVE_MANGADEX_REFERENCE_URL, { waitUntil: 'domcontentloaded' });

    const tabId = await getTabId(page, context);
    const liveState = await waitForLiveTabState(context, tabId);

    expect(liveState.siteIntegrationId).toBe('mangadex');
    expect(Array.isArray(liveState.chapters)).toBe(true);

    const sidepanel = await openSidepanelHarness(context, extensionId, page);

    await expect(sidepanel.locator('#root')).toBeVisible();

    const titlePattern = new RegExp(escapeForRegex(liveState.seriesTitle ?? ''), 'i');
    await expect(sidepanel.getByText(titlePattern)).toBeVisible({ timeout: 30_000 });

    await expect(sidepanel.getByText(/No series detected/i)).toHaveCount(0);
    await expect(sidepanel.getByText(/not recognized as a manga series/i)).toHaveCount(0);

    await sidepanel.close();
    await page.close();
  });

  test('shows no-series guidance when active tab switches to unsupported page', async ({
    context,
    extensionId,
  }) => {
    const livePage = await context.newPage();
    await livePage.goto(LIVE_MANGADEX_REFERENCE_URL, { waitUntil: 'domcontentloaded' });

    const tabId = await getTabId(livePage, context);
    const liveState = await waitForLiveTabState(context, tabId);

    const sidepanelLive = await openSidepanelHarness(context, extensionId, livePage);

    await expect(sidepanelLive.locator('#root')).toBeVisible();
    await expect(
      sidepanelLive.getByText(new RegExp(escapeForRegex(liveState.seriesTitle ?? ''), 'i')),
    ).toBeVisible({ timeout: 30_000 });

    const unsupportedPage = await context.newPage();
    await unsupportedPage.goto(buildExampleUrl('/'), { waitUntil: 'domcontentloaded' });
    const sidepanelUnsupported = await openSidepanelHarness(context, extensionId, unsupportedPage);

    await expect(sidepanelUnsupported.locator('#root')).toBeVisible();
    await expect(sidepanelUnsupported.getByText(/No series detected/i)).toBeVisible({ timeout: 30_000 });
    await expect(
      sidepanelUnsupported.getByText(new RegExp(escapeForRegex(liveState.seriesTitle ?? ''), 'i')),
    ).toHaveCount(0);

    await sidepanelUnsupported.close();
    await unsupportedPage.close();
    await sidepanelLive.close();
    await livePage.close();
  });
});
