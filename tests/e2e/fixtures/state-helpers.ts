/**
 * @file state-helpers.ts
 * @description Helpers for managing and inspecting chrome.storage.session state during E2E tests
 * 
 * ARCHITECTURE: Site-Specific Mock Data
 * - Uses site-integration-specific mock data from ./mock-data/site-integrations (mangadex)
 * - Each site integration has realistic URLs and HTML structures matching actual sites
 * - Shared data (download tasks, settings) in ./mock-data/shared
 */

import type { Page, BrowserContext } from '@playwright/test';
import { projectToQueueView } from '../../../entrypoints/background/projection';
import { DEFAULT_SETTINGS } from '../../../src/storage/default-settings';
import { getExternalTabInitStorageKey } from '../../../src/runtime/external-tab-init';
import { SESSION_STORAGE_KEYS } from '../../../src/runtime/storage-keys';
import type { DownloadTaskState, GlobalAppState, QueueTaskSummary } from '../../../src/types/queue-state';
import type { MangaPageState } from '../../../src/types/tab-state';
import { StateAction } from '../../../src/types/state-actions';
import type { InitializeTabReadyPayload } from '../../../src/types/state-action-tab-payloads';
import { MANGADEX_GENERIC_SERIES_URL } from './test-domains';

type InitializeTabActionPayload = Omit<InitializeTabReadyPayload, 'context'>;

async function getServiceWorker(context: BrowserContext): Promise<import('@playwright/test').Worker> {
  const expectedName = 'Tako Manga Downloader'
  const isOurWorker = async (sw: import('@playwright/test').Worker): Promise<boolean> => {
    try {
      const name = await sw.evaluate(() => chrome.runtime.getManifest().name)
      return name === expectedName
    } catch {
      return false
    }

  }

  for (let attempt = 0; attempt < 30; attempt++) {
    const candidates = context.serviceWorkers().filter((sw) => sw.url().startsWith('chrome-extension://'))
    for (const sw of candidates) {
      if (await isOurWorker(sw)) return sw
    }

    try {
      await context.waitForEvent('serviceworker', { timeout: 1000 })
    } catch {
      void 0
    }
  }

  throw new Error('Service worker not found - extension may not be loaded')
}

/**
 * Helper to create a new page in the context
 */
export async function createPage(context: BrowserContext): Promise<Page> {
  return await context.newPage();
}

type SidepanelHarnessOptions = {
  returnFocusToSidepanel?: boolean
}

export async function bindSidepanelHarness(
  sidepanelPage: Page,
  boundPage: Page,
  options: SidepanelHarnessOptions = {}
): Promise<void> {
  await boundPage.bringToFront()
  if (options.returnFocusToSidepanel) {
    await sidepanelPage.bringToFront()
  }
}

export async function openSidepanelHarness(
  context: BrowserContext,
  extensionId: string,
  boundPage: Page,
  options: SidepanelHarnessOptions = {}
): Promise<Page> {
  const sidepanelPage = await context.newPage()
  await sidepanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })
  await bindSidepanelHarness(sidepanelPage, boundPage, options)
  return sidepanelPage
}

export async function reloadSidepanelHarness(
  sidepanelPage: Page,
  boundPage: Page,
  options: SidepanelHarnessOptions = {}
): Promise<void> {
  await sidepanelPage.reload({ waitUntil: 'domcontentloaded' })
  await bindSidepanelHarness(sidepanelPage, boundPage, options)
}

export async function initializeTabViaAction(
  page: Page,
  context: BrowserContext,
  extensionId: string,
  payload: InitializeTabActionPayload,
  navigateToUrl: string = MANGADEX_GENERIC_SERIES_URL
): Promise<number> {
  const expectedSiteId = payload.siteIntegrationId;
  const expectedSeriesId = payload.mangaId;
  const expectedSeriesTitle = payload.seriesTitle;
  const expectedChaptersCount = payload.chapters?.length ?? 0;

  const isExpectedState = (state: MangaPageState | undefined): state is MangaPageState => {
    if (!state) return false;
    if (state.seriesTitle !== expectedSeriesTitle) return false;
    if (state.siteIntegrationId !== expectedSiteId) return false;
    if (state.mangaId !== expectedSeriesId) return false;
    if (!Array.isArray(state.chapters)) return false;
    if (!Array.isArray(state.volumes)) return false;

    // Allow richer chapter sets if content scripts refresh with fuller data
    // during initialization races.
    return state.chapters.length >= expectedChaptersCount;
  };

  if (!expectedSiteId || !expectedSeriesId || !expectedSeriesTitle) {
    throw new Error('initializeTabViaAction requires ready INITIALIZE_TAB payload with site+series fields');
  }

  const tabId = await getTabId(page, context)
  await markExternalTabInitializationForTest(context, tabId)
  if (page.url() !== navigateToUrl) {
    await page.goto(navigateToUrl, { waitUntil: 'domcontentloaded' })
  }
  const sendInitAction = async (): Promise<void> => {
    const ext = await context.newPage()
    await ext.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })
    await ext.evaluate(async ({ tabId, payload, action }) => {
      await chrome.runtime.sendMessage({
        type: 'STATE_ACTION',
        action,
        payload: {
          context: 'ready',
          ...payload,
        },
        tabId,
        timestamp: Date.now(),
      })
    }, { tabId, payload, action: StateAction.INITIALIZE_TAB })
    await ext.close()
  }

  const waitForInitState = async (timeoutMs: number): Promise<MangaPageState | undefined> => {
    const start = Date.now()
    let lastState: MangaPageState | undefined
    while (Date.now() - start < timeoutMs) {
      const state = await getSessionState<MangaPageState>(context, `tab_${tabId}`)
      lastState = state
      if (isExpectedState(state)) {
        return state
      }
      await page.waitForTimeout(100)
    }
    return lastState
  }

  const restoreFocusAndWaitForProjectedContext = async (timeoutMs: number): Promise<void> => {
    await focusTab(context, tabId)
    try {
      await page.bringToFront()
    } catch {
      void 0
    }

    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const activeContext = await getSessionState<MangaPageState | { seriesTitle?: string; mangaId?: string }>(context, 'activeTabContext')
      if (
        activeContext
        && activeContext.seriesTitle === expectedSeriesTitle
        && (activeContext as { mangaId?: string }).mangaId === expectedSeriesId
      ) {
        return
      }

      await page.waitForTimeout(100)
    }
  }

  await sendInitAction()
  const firstState = await waitForInitState(15000)
  if (isExpectedState(firstState)) {
    await restoreFocusAndWaitForProjectedContext(5000)
    return tabId
  }

  await markExternalTabInitializationForTest(context, tabId)
  await sendInitAction()
  const retryState = await waitForInitState(10000)
  if (isExpectedState(retryState)) {
    await restoreFocusAndWaitForProjectedContext(5000)
    return tabId
  }

  throw new Error(`initializeTabViaAction: timed out waiting for tab_${tabId} state (last state: ${JSON.stringify(retryState)})`)
}

/**
 * Helper to close a page safely
 */
export async function closePage(page: Page): Promise<void> {
  if (!page.isClosed()) {
    await page.close();
  }
}

/**
 * Get session storage state for a specific key
 */
export async function getSessionState<T = unknown>(
  context: BrowserContext,
  key: string
): Promise<T | undefined> {
  const worker = await getServiceWorker(context);

  return await worker.evaluate(async (storageKey: string) => {
    // In rare cases chrome.storage may not yet be fully available; treat as missing state.
    const maxAttempts = 10;
    const delayMs = 100;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if ((chrome as any)?.storage?.session) {
        const result = await chrome.storage.session.get(storageKey);
        return result[storageKey] as T | undefined;
      }

      if (typeof setTimeout === 'function') {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        const start = Date.now();
        while (Date.now() - start < delayMs) {
          void 0;
        }
      }
    }

    return undefined;
  }, key);
}

/**
 * Set session storage state for a specific key
 */
export async function setSessionState<T = unknown>(
  context: BrowserContext,
  key: string,
  value: T
): Promise<void> {
  const worker = await getServiceWorker(context);

  // Use JSON serialization to pass complex objects
  const serializedValue = JSON.stringify(value);
  await worker.evaluate(async ({ key: storageKey, value: serialized }: { key: string; value: string }) => {
    const parsedValue = JSON.parse(serialized);
    const maxAttempts = 10;
    const delayMs = 100;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if ((chrome as any)?.storage?.session) {
        await chrome.storage.session.set({ [storageKey]: parsedValue });
        return;
      }

      if (typeof setTimeout === 'function') {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        const start = Date.now();
        while (Date.now() - start < delayMs) {
          void 0;
        }
      }
    }
  }, { key, value: serializedValue });
}

export async function setLocalState<T = unknown>(
  context: BrowserContext,
  key: string,
  value: T,
): Promise<void> {
  const worker = await getServiceWorker(context)

  const serializedValue = JSON.stringify(value)
  await worker.evaluate(async ({ key: storageKey, value: serialized }: { key: string; value: string }) => {
    const parsedValue = JSON.parse(serialized)
    const maxAttempts = 10
    const delayMs = 100

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if ((chrome as any)?.storage?.local) {
        await chrome.storage.local.set({ [storageKey]: parsedValue })
        return
      }

      if (typeof setTimeout === 'function') {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      } else {
        const start = Date.now()
        while (Date.now() - start < delayMs) {
          void 0
        }
      }
    }
  }, { key, value: serializedValue })
}

export async function seedDownloadQueueState(
  page: Page,
  queue: DownloadTaskState[],
): Promise<void> {
  const context = page.context()
  const ids = queue.map((task) => task.id).sort()
  const projected = projectToQueueView(queue)
  const worker = await getServiceWorker(context)

  if (queue.some((task) => task.status === 'downloading')) {
    await ensureOffscreenAliveForActiveQueue(context)
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await getGlobalState(context)
    const next = {
      ...(existing ?? {}),
      downloadQueue: queue,
      settings: existing?.settings ?? DEFAULT_SETTINGS,
      lastActivity: Date.now(),
    }

    await setLocalState(context, 'downloadQueue', queue)
    await setSessionState(context, SESSION_STORAGE_KEYS.globalState, next as GlobalAppState)
    await setSessionState(context, 'queueView', projected.queueView as QueueTaskSummary[])
    await setSessionState(context, 'lastOffscreenActivity', next.lastActivity)

    try {
      await waitForGlobalState(context, (state) => {
        const seededQueue = state.downloadQueue ?? []
        if (seededQueue.length !== queue.length) {
          return false
        }

        const queueIds = seededQueue.map((task) => task.id).sort()
        return queueIds.length === ids.length && queueIds.every((id, index) => id === ids[index])
      }, { timeout: 15000 })

      const localQueueSeeded = await worker.evaluate(async (expectedIds: string[]) => {
        const result = await chrome.storage.local.get('downloadQueue') as {
          downloadQueue?: Array<{ id?: string }>
        }
        const queue = Array.isArray(result.downloadQueue) ? result.downloadQueue : []
        const queueIds = queue
          .map((task) => (typeof task?.id === 'string' ? task.id : null))
          .filter((id): id is string => id !== null)
          .sort()

        return queueIds.length === expectedIds.length
          && queueIds.every((id, index) => id === expectedIds[index])
      }, ids)

      if (!localQueueSeeded) {
        throw new Error('downloadQueue not seeded yet')
      }

      return
    } catch (error) {
      if (attempt === 2) {
        throw error
      }

      await page.waitForTimeout(150)
    }
  }
}

export async function ensureOffscreenAliveForActiveQueue(context: BrowserContext): Promise<void> {
  const worker = await getServiceWorker(context)

  await worker.evaluate(async () => {
    const now = Date.now()
    await chrome.storage.session.set({ lastOffscreenActivity: now })

    type RuntimeGetContexts = (params: {
      contextTypes: Array<'OFFSCREEN_DOCUMENT'>
      documentUrls: string[]
    }) => Promise<unknown[]>

    const runtimeWithGetContexts = chrome.runtime as unknown as { getContexts?: RuntimeGetContexts }
    const offscreenUrl = chrome.runtime.getURL('offscreen.html')
    const existingContexts = runtimeWithGetContexts.getContexts
      ? await runtimeWithGetContexts.getContexts({
          contextTypes: ['OFFSCREEN_DOCUMENT'],
          documentUrls: [offscreenUrl],
        })
      : []

    if (Array.isArray(existingContexts) && existingContexts.length > 0) {
      return
    }

    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [
        chrome.offscreen.Reason.BLOBS,
        chrome.offscreen.Reason.WORKERS,
      ],
      justification: 'Keep seeded downloading tasks alive during Playwright E2E queue/history scenarios',
    })
  })
}

/**
 * Mark a tab as externally initialized so the content script consumes the next duplicate init attempt.
 */
export async function markExternalTabInitializationForTest(
  context: BrowserContext,
  tabId: number
): Promise<void> {
  await setSessionState(context, getExternalTabInitStorageKey(tabId), Date.now())
}

/**
 * Send a message to the content script for a specific tab
 */
export async function sendContentMessage(
  context: BrowserContext,
  tabId: number,
  message: unknown
): Promise<void> {
  const worker = await getServiceWorker(context);

  const maxAttempts = 15;
  const delayMs = 200;
  let attempt = 0;
  let lastError: unknown;
  while (attempt < maxAttempts) {
    try {
      await worker.evaluate(async ({ id, msg }: { id: number; msg: unknown }) => {
        await chrome.tabs.sendMessage(id, msg as any);
      }, { id: tabId, msg: message });
      return; // success
    } catch (err) {
      lastError = err;
      // Content script might not be ready yet; wait and retry
      await context.pages()[0]?.waitForTimeout(delayMs);
      attempt++;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to send content message');
}

/**
 * Get tab state for current page
 */
export async function getTabState(
  page: Page,
  context: BrowserContext
): Promise<MangaPageState | undefined> {
  const tabId = await getTabId(page, context);
  return await getSessionState<MangaPageState>(context, `tab_${tabId}`);
}

/**
 * Get global app state
 */
export async function getGlobalState(
  context: BrowserContext
): Promise<GlobalAppState | undefined> {
  return await getSessionState<GlobalAppState>(context, SESSION_STORAGE_KEYS.globalState);
}

/**
 * Get tab ID from Playwright Page object
 * 
 * Uses Chrome DevTools Protocol to reliably get the tab ID from Playwright's page object.
 * This works for all page types (web pages, extension pages) in E2E tests.
 */
export async function getTabId(page: Page, context: BrowserContext): Promise<number> {
  const worker = await getServiceWorker(context);

  try {
    await page.bringToFront();
  } catch {
    // Ignore focus errors and continue with best-effort tab resolution
  }
  
  // Ensure page has a stable URL to match tabs against
  let pageUrl = page.url();
  if (!pageUrl || pageUrl === 'about:blank') {
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 3000 });
      pageUrl = page.url();
    } catch {
      // keep as-is
    }
  }

  // Wait until chrome.tabs.query is available in the worker, then query for this page's tab by URL
  let attempts = 0;
  let chromeTabId: number | undefined;
  while (attempts < 20 && !chromeTabId) {
    const tabsAvailable = await worker.evaluate(() => !!(chrome as any)?.tabs && typeof (chrome as any).tabs.query === 'function').catch(() => false);
    if (!tabsAvailable) {
      await context.pages()[0]?.waitForTimeout(100);
      attempts++;
      continue;
    }
    const targetUrl = pageUrl;
    chromeTabId = await worker.evaluate(async (u: string | undefined) => {
      const tabs = await chrome.tabs.query({});
      const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
      const lastFocused = wins.find(w => w.focused) || wins[0];
      const active = lastFocused?.tabs?.find(t => t.active);

      const normalizeUrl = (value: string | undefined): string | undefined => {
        if (!value) {
          return undefined;
        }

        try {
          const parsed = new URL(value);
          parsed.hash = '';
          parsed.search = '';
          parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
          return parsed.toString();
        } catch {
          return value;
        }
      };

      const normalizedTarget = normalizeUrl(u);

      if (active && typeof active.id === 'number' && (!u || active.url === u)) {
        return active.id;
      }

      if (u) {
        const matches = tabs.filter(t => t.url === u);
        if (matches.length === 1 && typeof matches[0]?.id === 'number') {
          return matches[0].id;
        }

        const activeMatch = matches.find(t => t.active && typeof t.id === 'number');
        if (activeMatch && typeof activeMatch.id === 'number') {
          return activeMatch.id;
        }

        if (normalizedTarget) {
          const normalizedMatches = tabs.filter((tab) => normalizeUrl(tab.url) === normalizedTarget);
          if (normalizedMatches.length === 1 && typeof normalizedMatches[0]?.id === 'number') {
            return normalizedMatches[0].id;
          }

          const normalizedActiveMatch = normalizedMatches.find((tab) => tab.active && typeof tab.id === 'number');
          if (normalizedActiveMatch && typeof normalizedActiveMatch.id === 'number') {
            return normalizedActiveMatch.id;
          }
        }

        return undefined;
      }

      // Fallback: choose the active tab in the last focused normal window
      return (active?.id as number | undefined) ?? (tabs[0]?.id as number | undefined);
    }, targetUrl).catch(() => undefined);

    if (!chromeTabId) {
      await context.pages()[0]?.waitForTimeout(100);
      attempts++;
    }
  }
  
  if (!chromeTabId) {
    throw new Error('Tab ID is undefined');
  }
  
  return chromeTabId;
}

/**
 * Focus the given tab and its window so popup detects it as active.
 */
export async function focusTab(
  context: BrowserContext,
  tabId: number
): Promise<void> {
  const worker = await getServiceWorker(context);

  await worker.evaluate(async (id: number) => {
    try {
      const tab = await chrome.tabs.get(id);
      const winId = tab.windowId;
      if (typeof winId === 'number') {
        await chrome.windows.update(winId, { focused: true }).catch(() => {});
      }
      await chrome.tabs.update(id, { active: true }).catch(() => {});
    } catch {
      // ignore
    }
  }, tabId);
}

/**
 * Wait for tab state to match a condition
 */
export async function waitForTabState(
  page: Page,
  context: BrowserContext,
  condition: (state: MangaPageState) => boolean,
  options: { timeout?: number } = {}
): Promise<MangaPageState> {
  const timeout = options.timeout ?? 10000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const state = await getTabState(page, context);
    if (state && condition(state)) {
      return state;
    }
    await page.waitForTimeout(100);
  }

  throw new Error(`Timeout waiting for tab state condition after ${timeout}ms`);
}

/**
 * Wait for tab state to match a condition using a known tabId
 */
export async function waitForTabStateById(
  page: Page,
  context: BrowserContext,
  tabId: number,
  condition: (state: MangaPageState) => boolean,
  options: { timeout?: number } = {}
): Promise<MangaPageState> {
  const timeout = options.timeout ?? 10000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const state = await getSessionState<MangaPageState>(context, `tab_${tabId}`);
    if (state && condition(state)) {
      return state;
    }
    await page.waitForTimeout(100);
  }

  throw new Error(`Timeout waiting for tab ${tabId} state condition after ${timeout}ms`);
}

/**
 * Wait for global state to match a condition
 */
export async function waitForGlobalState(
  context: BrowserContext,
  condition: (state: GlobalAppState) => boolean,
  options: { timeout?: number } = {}
): Promise<GlobalAppState> {
  const timeout = options.timeout ?? 10000;
  const startTime = Date.now();
  let lastState: GlobalAppState | undefined;

  while (Date.now() - startTime < timeout) {
    const state = await getGlobalState(context);
    lastState = state;
    if (state && condition(state)) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timeout waiting for global state condition after ${timeout}ms. Last state: ${JSON.stringify(lastState)}`);
}

/**
 * Mock manga page state for testing
 * @param page - Playwright Page object  
 * @param context - Browser context
 * @param partialState - Partial state to merge with defaults
 * @param navigateToUrl - Optional URL to navigate to (defaults to about:blank)
 */
export async function mockMangaPageState(
  page: Page,
  context: BrowserContext,
  partialState: Partial<MangaPageState>,
  navigateToUrl: string = 'about:blank'
): Promise<void> {
  // Navigate to safe URL if not already there
  if (page.url() !== navigateToUrl) {
    await page.goto(navigateToUrl, { waitUntil: 'domcontentloaded' });
  }
  
  const tabId = await getTabId(page, context);
  
  const defaultState: MangaPageState = {
    siteIntegrationId: 'mangadex',
    mangaId: '106937',
    seriesTitle: 'Hunter x Hunter',
    chapters: [],
    volumes: [],
    lastUpdated: Date.now(),
    ...partialState,
  };

  await setSessionState(context, `tab_${tabId}`, defaultState);
}

/**
 * Clear all session storage (useful for test cleanup)
 */
export async function clearSessionStorage(context: BrowserContext): Promise<void> {
  const worker = await getServiceWorker(context);
  await worker.evaluate(async () => {
    const maxAttempts = 10;
    const delayMs = 100;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if ((chrome as any)?.storage?.session) {
        await chrome.storage.session.clear();
        return;
      }

      if (typeof setTimeout === 'function') {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        const start = Date.now();
        while (Date.now() - start < delayMs) {
          void 0;
        }
      }
    }
  });
}

/**
 * Send a state action to the background service worker
 */
export async function sendStateAction(
  context: BrowserContext,
  action: string,
  payload: unknown,
  tabId?: number
): Promise<void> {
  const worker = await getServiceWorker(context);
  await worker.evaluate(async (args: { action: string; payload: unknown; tabId?: number }) => {
    const maxAttempts = 10;
    const delayMs = 100;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if ((chrome as any)?.runtime?.sendMessage) {
        await chrome.runtime.sendMessage({
          type: 'STATE_ACTION',
          action: args.action,
          payload: args.payload,
          tabId: args.tabId,
          timestamp: Date.now(),
        });
        return;
      }

      if (typeof setTimeout === 'function') {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        const start = Date.now();
        while (Date.now() - start < delayMs) {
          void 0;
        }
      }
    }
  }, { action, payload, tabId });
}
