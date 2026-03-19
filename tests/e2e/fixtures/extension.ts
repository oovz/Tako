import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { registerTestRoutes } from './test-domains';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pathToExtension = path.resolve(__dirname, '../../../.output/chrome-mv3');
const shouldUseMockRoutes = process.env.TMD_TEST_E2E_USE_MOCKS === 'true';
const shouldAllowNetwork = process.env.TMD_TEST_E2E_ALLOW_NETWORK === 'true';

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  page: Page;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use, testInfo) => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmd-playwright-'));
    const headless = testInfo.project.use.headless ?? true;
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        '--no-sandbox',
        '--no-focus-on-launch',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
      ],
    });

    if (!shouldUseMockRoutes && !shouldAllowNetwork) {
      await context.close();
      await fs.rm(userDataDir, { recursive: true, force: true });
      throw new Error(
        'Invalid E2E route policy: both TMD_TEST_E2E_USE_MOCKS and TMD_TEST_E2E_ALLOW_NETWORK are false. ' +
        'Enable mock routes for deterministic E2E or allow network for live E2E.',
      );
    }

    await registerTestRoutes(context, {
      useMocks: shouldUseMockRoutes,
      allowNetwork: shouldAllowNetwork,
    });

    try {
      await use(context);
    } finally {
      await context.close();
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  },
  
  extensionId: async ({ context }, use) => {
    const expectedName = 'Tako Manga Downloader'
    const isBackgroundWorkerUrl = (url: string): boolean =>
      url.startsWith('chrome-extension://') && /\/background(?:\.js)?$/i.test(url)

    const isOurWorker = async (sw: import('@playwright/test').Worker): Promise<boolean> => {
      if (isBackgroundWorkerUrl(sw.url())) {
        return true
      }

      try {
        const name = await sw.evaluate(() => chrome.runtime.getManifest().name)
        return name === expectedName
      } catch {
        return false
      }
    }

    let background: import('@playwright/test').Worker | undefined
    for (let attempt = 0; attempt < 120; attempt++) {
      const candidates = context.serviceWorkers().filter((sw) => sw.url().startsWith('chrome-extension://'))
      for (const sw of candidates) {
        if (await isOurWorker(sw)) {
          background = sw
          break
        }
      }
      if (background) break

      try {
        await context.waitForEvent('serviceworker', {
          timeout: 2000,
          predicate: (sw) => sw.url().startsWith('chrome-extension://'),
        })
      } catch {
        void 0
      }
    }

    if (!background) {
      const seenWorkerUrls = context.serviceWorkers().map((sw) => sw.url())
      throw new Error(`Failed to locate Tako Manga Downloader service worker. Seen workers: ${JSON.stringify(seenWorkerUrls)}`)
    }

    // Parse from worker URL first; this avoids evaluate-races with suspended MV3 workers.
    let extensionId = background.url().split('/')[2] || '';

    if (!extensionId) {
      try {
        extensionId = await background.evaluate(() => chrome.runtime.id);
      } catch {
        extensionId = '';
      }
    }

    if (!extensionId) {
      throw new Error('Resolved service worker but failed to derive extension ID')
    }

    await use(extensionId);
  },

  page: async ({ context }, use) => {
    // Reuse the first page that launchPersistentContext creates
    // This prevents creating unnecessary tabs (launchPersistentContext already opens one tab)
    const page = context.pages()[0] || await context.newPage();
    await use(page);
    // Don't close the page - let context manage it
  },
});

export const expect = test.expect;
