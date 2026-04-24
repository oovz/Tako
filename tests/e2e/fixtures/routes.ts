/**
 * @file routes.ts
 * @description Top-level e2e route dispatcher.
 *
 * This module is the single entry point `extension.ts` uses to install all
 * Playwright route mocks for a test context. It owns:
 *
 * 1. Route-policy validation (every context must either use deterministic
 *    mocks OR permit live network; never neither).
 * 2. A small `example.com` catch-all for chapter URLs that intentionally
 *    bounce to the synthetic EXAMPLE_BASE_URL in specs.
 * 3. Invocation of every site integration's `RouteRegistrar` — one per
 *    supported integration in `SITE_INTEGRATION_MANIFESTS`. Registrars live
 *    next to their mock data at
 *    `tests/e2e/fixtures/mock-data/site-integrations/{id}/routes.ts`.
 *
 * New site integrations MUST add their registrar here. See
 * `RouteRegistrar` in `mock-data/types.ts` for the contract.
 */

import type { BrowserContext, Route } from '@playwright/test';
import type { RouteRegistrar, RouteRegistrarOptions } from './mock-data/types';
import { registerMangadexRoutes } from './mock-data/site-integrations/mangadex';
import { registerManhuaguiRoutes } from './mock-data/site-integrations/manhuagui';
import { registerPixivComicRoutes } from './mock-data/site-integrations/pixiv-comic';
import { registerShonenJumpPlusRoutes } from './mock-data/site-integrations/shonenjumpplus';
import { EXAMPLE_TEST_DOMAIN } from './test-domains-constants';

const DEFAULT_HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body>Test Page</body></html>';

const siteIntegrationRegistrars: ReadonlyArray<RouteRegistrar> = [
  registerMangadexRoutes,
  registerManhuaguiRoutes,
  registerPixivComicRoutes,
  registerShonenJumpPlusRoutes,
];

async function registerExampleCatchAll(
  context: BrowserContext,
  options: RouteRegistrarOptions,
): Promise<void> {
  if (!options.useMocks) {
    return;
  }

  await context.route(`https://${EXAMPLE_TEST_DOMAIN}/**`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: DEFAULT_HTML,
    });
  });
}

/**
 * Install all deterministic e2e mocks for a Playwright BrowserContext.
 *
 * Route policy (enforced):
 * - `useMocks=true` + `allowNetwork=false` (default for `playwright.config.ts`)
 * - `useMocks=false` + `allowNetwork=true` (live tests in `playwright.live.config.ts`)
 * - Any other combination throws.
 */
export async function registerTestRoutes(
  context: BrowserContext,
  options?: Partial<RouteRegistrarOptions>,
): Promise<void> {
  const useMocks = options?.useMocks === true;
  const allowNetwork = options?.allowNetwork === true;

  if (!useMocks) {
    if (!allowNetwork) {
      throw new Error(
        'registerTestRoutes: invalid route policy (useMocks=false, allowNetwork=false).',
      );
    }
    return;
  }

  const resolved: RouteRegistrarOptions = { useMocks, allowNetwork };

  await registerExampleCatchAll(context, resolved);
  await Promise.all(
    siteIntegrationRegistrars.map((register) => register(context, resolved)),
  );
}
