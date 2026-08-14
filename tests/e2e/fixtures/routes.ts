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
 *    supported integration in the generated site integration catalog. Runtime
 *    adapter lookup is static.
 *    next to their mock data at
 *    `tests/e2e/fixtures/mock-data/site-integrations/{id}/routes.ts`.
 *
 * New site integrations MUST add their registrar here. See
 * `RouteRegistrar` in `mock-data/types.ts` for the contract.
 */

import type { BrowserContext, Route } from "@playwright/test"
import type { RouteRegistrar, RouteRegistrarOptions } from "./mock-data/types"
import { registerMangadexRoutes } from "./mock-data/site-integrations/mangadex"
import { registerManhuaguiRoutes } from "./mock-data/site-integrations/manhuagui"
import { registerPixivComicRoutes } from "./mock-data/site-integrations/pixiv-comic"
import { registerShonenJumpPlusRoutes } from "./mock-data/site-integrations/shonenjumpplus"
import { registerComicNettaiRoutes } from "./mock-data/site-integrations/comicnettai"
import { EXAMPLE_TEST_DOMAIN } from "./test-domains-constants"

const DEFAULT_HTML =
  '<!doctype html><html><head><meta charset="utf-8"></head><body>Test Page</body></html>'

const siteIntegrationRegistrars: ReadonlyArray<RouteRegistrar> = [
  registerMangadexRoutes,
  registerManhuaguiRoutes,
  registerPixivComicRoutes,
  registerShonenJumpPlusRoutes,
  registerComicNettaiRoutes,
]

export function shouldBlockUnmatchedRequest(
  requestUrl: string,
  allowNetwork: boolean,
  allowedOrigins: readonly string[] = []
): boolean {
  if (allowNetwork) return false
  try {
    const url = new URL(requestUrl)
    if (allowedOrigins.includes(url.origin)) return false
    const protocol = url.protocol
    return protocol === "http:" || protocol === "https:"
  } catch {
    return false
  }
}

async function registerUnmatchedExternalRequestGuard(
  context: BrowserContext,
  allowNetwork: boolean,
  allowedOrigins: readonly string[]
): Promise<void> {
  // Register first: Playwright evaluates routes in reverse registration order,
  // so integration-specific handlers get first refusal and fall through here.
  await context.route("**/*", async (route: Route) => {
    if (
      shouldBlockUnmatchedRequest(
        route.request().url(),
        allowNetwork,
        allowedOrigins
      )
    ) {
      await route.abort("blockedbyclient")
      return
    }
    await route.fallback()
  })
}

async function registerExampleCatchAll(
  context: BrowserContext,
  options: RouteRegistrarOptions
): Promise<void> {
  if (!options.useMocks) {
    return
  }

  await context.route(
    `https://${EXAMPLE_TEST_DOMAIN}/**`,
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: DEFAULT_HTML,
      })
    }
  )
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
  allowedOrigins: readonly string[] = []
): Promise<void> {
  const useMocks = options?.useMocks === true
  const allowNetwork = options?.allowNetwork === true

  if (!useMocks) {
    if (!allowNetwork) {
      throw new Error(
        "registerTestRoutes: invalid route policy (useMocks=false, allowNetwork=false)."
      )
    }
    return
  }

  const resolved: RouteRegistrarOptions = { useMocks, allowNetwork }

  await registerUnmatchedExternalRequestGuard(
    context,
    allowNetwork,
    allowedOrigins
  )
  await registerExampleCatchAll(context, resolved)
  await Promise.all(
    siteIntegrationRegistrars.map((register) => register(context, resolved))
  )
}
