import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { clearDnrRedirectRules, installDnrRedirectRules, type DnrRedirectRule } from './dnr-test-redirects';
import { startLocalMockServer, type LocalMockServerHandle } from './local-mock-server';
import { registerMangadexLocalServerHandlers } from './mock-data/site-integrations/mangadex/local-server';
import { registerManhuaguiLocalServerHandlers } from './mock-data/site-integrations/manhuagui/local-server';
import { registerPixivComicLocalServerHandlers } from './mock-data/site-integrations/pixiv-comic/local-server';
import { registerShonenJumpPlusLocalServerHandlers } from './mock-data/site-integrations/shonenjumpplus/local-server';
import { registerTestRoutes } from './routes';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pathToExtension = path.resolve(__dirname, '../../../.output/chrome-mv3');
const shouldUseMockRoutes = process.env.TMD_TEST_E2E_USE_MOCKS === 'true';
const shouldAllowNetwork = process.env.TMD_TEST_E2E_ALLOW_NETWORK === 'true';

const BACKGROUND_WORKER_NAME = 'Tako Manga Downloader';

function isBackgroundWorkerUrl(url: string): boolean {
  return url.startsWith('chrome-extension://') && /\/background(?:\.js)?$/i.test(url);
}

async function isOurBackgroundWorker(sw: Worker): Promise<boolean> {
  if (isBackgroundWorkerUrl(sw.url())) return true;
  try {
    const name = await sw.evaluate(() => chrome.runtime.getManifest().name);
    return name === BACKGROUND_WORKER_NAME;
  } catch {
    return false;
  }
}

async function resolveBackgroundWorker(context: BrowserContext): Promise<Worker> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const candidates = context.serviceWorkers().filter((sw) => sw.url().startsWith('chrome-extension://'));
    for (const sw of candidates) {
      if (await isOurBackgroundWorker(sw)) return sw;
    }

    try {
      await context.waitForEvent('serviceworker', {
        timeout: 2000,
        predicate: (sw) => sw.url().startsWith('chrome-extension://'),
      });
    } catch {
      void 0;
    }
  }

  const seenWorkerUrls = context.serviceWorkers().map((sw) => sw.url());
  throw new Error(
    `Failed to locate ${BACKGROUND_WORKER_NAME} service worker. Seen workers: ${JSON.stringify(seenWorkerUrls)}`,
  );
}

/**
 * Shared context + fixture state for a single test. Fixtures hand
 * instances of this down through `context`/`extensionId` so teardown can
 * run in reverse setup order (DNR rules cleared → local server closed →
 * Chromium closed → user-data dir removed).
 */
interface ExtensionContextState {
  context: BrowserContext;
  extensionId: string;
  backgroundWorker: Worker;
  localMockServer: LocalMockServerHandle | null;
  userDataDir: string;
  teardown: () => Promise<void>;
}

async function setupExtensionContext(testInfoHeadless: boolean): Promise<ExtensionContextState> {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmd-playwright-'));

  // Phase 3 download-workflow specs need to intercept offscreen-initiated
  // fetches. Playwright's context.route doesn't cover those, so we spin up
  // a local HTTP mock server and install DNR redirect rules later to
  // steer specific external URLs at it.
  let localMockServer: LocalMockServerHandle | null = null;
  let dnrRulesToInstall: DnrRedirectRule[] = [];
  if (shouldUseMockRoutes) {
    localMockServer = await startLocalMockServer();
    dnrRulesToInstall = [
      ...registerMangadexLocalServerHandlers(localMockServer),
      ...registerManhuaguiLocalServerHandlers(localMockServer),
      ...registerPixivComicLocalServerHandlers(localMockServer),
      ...registerShonenJumpPlusLocalServerHandlers(localMockServer),
    ];
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: testInfoHeadless,
    args: [
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
      '--no-sandbox',
      '--no-focus-on-launch',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      // Chromium 142+ enforces Local Network Access (LNA): fetches
      // from public origins (e.g. mangadex.org, comic.pixiv.net) to
      // loopback/private addresses (127.0.0.1) are blocked with
      // "Permission was denied for this request to access the
      // `loopback` address space" unless the user grants an
      // interactive prompt. DNR rules in the test fixtures redirect
      // public URLs to the local mock server on 127.0.0.1, and the
      // prompt can't be auto-accepted in a persistent context, so we
      // disable the enforcement feature (and the earlier PNA features
      // it replaced, for older Chrome channels).
      //
      // See https://developer.chrome.com/blog/local-network-access
      // and https://chromestatus.com/feature/5085655327047680 for the
      // feature definitions.
      '--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests',
    ],
  });

  if (!shouldUseMockRoutes && !shouldAllowNetwork) {
    await context.close();
    if (localMockServer) await localMockServer.close();
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

  const backgroundWorker = await resolveBackgroundWorker(context);

  // Parse from worker URL first; avoids evaluate races with suspended MV3 workers.
  let extensionId = backgroundWorker.url().split('/')[2] || '';
  if (!extensionId) {
    try {
      extensionId = await backgroundWorker.evaluate(() => chrome.runtime.id);
    } catch {
      extensionId = '';
    }
  }
  if (!extensionId) {
    await context.close();
    if (localMockServer) await localMockServer.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
    throw new Error('Resolved service worker but failed to derive extension ID');
  }

  if (dnrRulesToInstall.length > 0) {
    await installDnrRedirectRules(backgroundWorker, extensionId, dnrRulesToInstall);
  }

  const teardown = async (): Promise<void> => {
    // Best-effort cleanup: log but don't throw so one failure doesn't
    // leak the other resources.
    if (dnrRulesToInstall.length > 0) {
      try {
        await clearDnrRedirectRules(backgroundWorker);
      } catch (error) {
        console.warn('[extension.fixture] failed to clear DNR test rules:', error);
      }
    }
    await context.close();
    if (localMockServer) await localMockServer.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  };

  return { context, extensionId, backgroundWorker, localMockServer, userDataDir, teardown };
}

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  page: Page;
  _extensionContextState: ExtensionContextState;
}>({
  // eslint-disable-next-line no-empty-pattern
  _extensionContextState: async ({}, use, testInfo) => {
    const headless = testInfo.project.use.headless ?? true;
    const state = await setupExtensionContext(headless);
    try {
      await use(state);
    } finally {
      await state.teardown();
    }
  },

  context: async ({ _extensionContextState }, use) => {
    await use(_extensionContextState.context);
  },

  extensionId: async ({ _extensionContextState }, use) => {
    await use(_extensionContextState.extensionId);
  },

  page: async ({ context }, use) => {
    // Reuse the first page that launchPersistentContext creates
    // This prevents creating unnecessary tabs (launchPersistentContext already opens one tab)
    const page = context.pages()[0] || await context.newPage();

    // TEMP DIAGNOSTIC: dump page console + network activity so we can
    // trace why content-script fetches might not reach the local server.
    if (process.env.TMD_TEST_E2E_DIAG === 'true') {
      page.on('console', (msg) => {
        console.log('[page console]', msg.type(), msg.text());
      });
      page.on('pageerror', (err) => {
        console.log('[page error]', err.message);
      });
      page.on('request', (req) => {
        console.log('[page request]', req.method(), req.url(), 'resourceType=', req.resourceType());
      });
      page.on('response', (res) => {
        console.log('[page response]', res.status(), res.url());
      });
      page.on('requestfailed', (req) => {
        console.log('[page requestfailed]', req.url(), req.failure()?.errorText);
      });
    }

    await use(page);
    // Don't close the page - let context manage it
  },
});

export const expect = test.expect;
