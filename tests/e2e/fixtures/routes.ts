/** Register each supported integration’s page routes and enforce network policy. */

import type { BrowserContext, Route } from "@playwright/test"
import type { RouteRegistrar, RouteRegistrarOptions } from "./mock-data/types"
import { registerMangadexRoutes } from "./mock-data/site-integrations/mangadex"
import { registerManhuaguiRoutes } from "./mock-data/site-integrations/readmanga"
import { registerPixivComicRoutes } from "./mock-data/site-integrations/pixiv-comic"
import { registerShonenJumpPlusRoutes } from "./mock-data/site-integrations/shonenjumpplus"
import { registerComicNettaiRoutes } from "./mock-data/site-integrations/comictropics"
import { registerMangaMillionRoutes } from "./mock-data/site-integrations/mangamillion"
import { registerManganatoRoutes } from "./mock-data/site-integrations/manganato/routes"
import { registerMangakakalotRoutes } from "./mock-data/site-integrations/mangakakalot/routes"
import { registerBoyloveRoutes } from "./mock-data/site-integrations/boylove/routes"
import { registerCopyRoutes } from "./mock-data/site-integrations/copymanga/routes"
import { registerMycomicRoutes } from "./mock-data/site-integrations/mycomic/routes"
import { registerDm5Routes } from "./mock-data/site-integrations/animemangahouse/routes"
import { registerMangabzRoutes } from "./mock-data/site-integrations/mangabz/routes"
import { registerZaimanhuaRoutes } from "./mock-data/site-integrations/mangaagain/routes"
import { registerAimanhuaRoutes } from "./mock-data/site-integrations/lovemanga/routes"
import { registerMangahereRoutes } from "./mock-data/site-integrations/mangahere/routes"
import { registerMangagoRoutes } from "./mock-data/site-integrations/mangago/routes"
import { registerCoolmicRoutes } from "./mock-data/site-integrations/coolmic/routes"
import { registerMangaplusRoutes } from "./mock-data/site-integrations/mangaplus/routes"
import { EXAMPLE_TEST_DOMAIN } from "./test-domains-constants"

const DEFAULT_HTML =
  '<!doctype html><html><head><meta charset="utf-8"></head><body>Test Page</body></html>'

const siteIntegrationRegistrars: ReadonlyArray<RouteRegistrar> = [
  registerMangadexRoutes,
  registerManhuaguiRoutes,
  registerPixivComicRoutes,
  registerShonenJumpPlusRoutes,
  registerComicNettaiRoutes,
  registerMangaMillionRoutes,
  registerManganatoRoutes,
  registerMangakakalotRoutes,
  registerBoyloveRoutes,
  registerCopyRoutes,
  registerMycomicRoutes,
  registerDm5Routes,
  registerMangabzRoutes,
  registerZaimanhuaRoutes,
  registerAimanhuaRoutes,
  registerMangahereRoutes,
  registerMangagoRoutes,
  registerCoolmicRoutes,
  registerMangaplusRoutes,
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
 * Install provider mocks when enabled. Without mocks, network access must be
 * explicitly allowed. Unmatched HTTP(S) requests follow the network policy.
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
