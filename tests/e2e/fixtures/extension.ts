import {
  test as base,
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"
import {
  clearDnrRedirectRules,
  installDnrRedirectRules,
  type DnrRedirectRule,
} from "./dnr-test-redirects"
import {
  startLocalMockServer,
  type LocalMockServerHandle,
} from "./local-mock-server"
import { registerMangadexLocalServerHandlers } from "./mock-data/site-integrations/mangadex/local-server"
import { registerManhuaguiLocalServerHandlers } from "./mock-data/site-integrations/manhuagui/local-server"
import { registerPixivComicLocalServerHandlers } from "./mock-data/site-integrations/pixiv-comic/local-server"
import { registerShonenJumpPlusLocalServerHandlers } from "./mock-data/site-integrations/shonenjumpplus/local-server"
import { registerComicNettaiLocalServerHandlers } from "./mock-data/site-integrations/comicnettai/local-server"
import { registerTestRoutes } from "./routes"
import { SITE_INTEGRATION_MANIFESTS } from "../../../src/site-integrations/manifest"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const shouldUseMockRoutes = process.env.TMD_TEST_E2E_USE_MOCKS === "true"
const shouldAllowNetwork = process.env.TMD_TEST_E2E_ALLOW_NETWORK === "true"
const shouldEnableLiveIntegrations = process.env.TMD_TEST_E2E_LIVE === "true"
// CI uses Playwright's Chromium 151 canary because the extension requires
// Chrome 150+. Developers can select a compatible installed browser channel
// through TMD_TEST_E2E_BROWSER_CHANNEL when their environment cannot use the
// Playwright-managed channel.
const e2eBrowserChannel =
  process.env.TMD_TEST_E2E_BROWSER_CHANNEL ?? "chromium-tip-of-tree"
const pathToExtension = path.resolve(
  __dirname,
  shouldEnableLiveIntegrations
    ? "../../../.output/chrome-mv3-live-test"
    : "../../../.output/chrome-mv3-e2e-test"
)
const collectCoverage = process.env.E2E_COVERAGE === "true"
const nycOutputDir = path.resolve(__dirname, "../../../.nyc_output/e2e")

const BACKGROUND_WORKER_NAME = "Tako Manga Downloader"
const E2E_SEED_DOWNLOAD_QUEUE_MESSAGE = "E2E_SEED_DOWNLOAD_QUEUE"

type CoverageTargetKind = "page" | "worker"

const collectedCoverageTargets = new WeakSet<object>()
const coverageCloseHooks = new WeakSet<Page>()

async function writeCoverage(
  coverage: unknown,
  targetKind: CoverageTargetKind
): Promise<void> {
  if (!coverage) return
  await fs.mkdir(nycOutputDir, { recursive: true })
  await fs.writeFile(
    path.join(
      nycOutputDir,
      `coverage-${targetKind}-${crypto.randomUUID()}.json`
    ),
    JSON.stringify(coverage),
    "utf8"
  )
}

/**
 * Collect window.__coverage__ from a page before it closes. Closed pages are
 * otherwise absent from BrowserContext.pages() at fixture teardown.
 */
async function collectPageCoverage(page: Page): Promise<void> {
  if (!collectCoverage || collectedCoverageTargets.has(page)) return
  collectedCoverageTargets.add(page)
  try {
    const coverage = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__coverage__
    )
    await writeCoverage(coverage, "page")
  } catch {
    // Page may have been closed or navigated away – best effort.
  }
}

/** Collect global coverage from an instrumented MV3 service worker. */
async function collectWorkerCoverage(worker: Worker): Promise<void> {
  if (!collectCoverage || collectedCoverageTargets.has(worker)) return
  collectedCoverageTargets.add(worker)
  try {
    const coverage = await worker.evaluate(
      () => (globalThis as unknown as Record<string, unknown>).__coverage__
    )
    await writeCoverage(coverage, "worker")
  } catch {
    // A service worker may be terminated before teardown. The next live worker
    // in the context is still collected below when available.
  }
}

function installPageCoverageCloseHook(page: Page): void {
  if (!collectCoverage || coverageCloseHooks.has(page)) return
  coverageCloseHooks.add(page)

  const close = page.close.bind(page)
  page.close = async (...args: Parameters<Page["close"]>) => {
    await collectPageCoverage(page)
    return close(...args)
  }
}

/**
 * Collect coverage from all chrome-extension:// pages in the context
 * (side panel, options, offscreen), regular test pages, and the MV3 service
 * worker. Page close hooks cover pages that specs intentionally close early.
 */
async function collectContextCoverage(
  context: BrowserContext,
  backgroundWorker?: Worker
): Promise<void> {
  if (!collectCoverage) return
  const pages = context.pages()
  const workers = Array.from(
    new Set(
      [backgroundWorker, ...context.serviceWorkers()].filter(
        (worker): worker is Worker => worker !== undefined
      )
    )
  )
  await Promise.allSettled([
    ...pages.map((page) => collectPageCoverage(page)),
    ...workers.map((worker) => collectWorkerCoverage(worker)),
  ])
}

function installCoverageHooks(context: BrowserContext): void {
  if (!collectCoverage) return
  for (const page of context.pages()) {
    installPageCoverageCloseHook(page)
  }
  context.on("page", installPageCoverageCloseHook)
}

function isBackgroundWorkerUrl(url: string): boolean {
  return (
    url.startsWith("chrome-extension://") && /\/background(?:\.js)?$/i.test(url)
  )
}

async function isOurBackgroundWorker(sw: Worker): Promise<boolean> {
  if (isBackgroundWorkerUrl(sw.url())) return true
  try {
    const name = await sw.evaluate(() => chrome.runtime.getManifest().name)
    return name === BACKGROUND_WORKER_NAME
  } catch {
    return false
  }
}

async function resolveBackgroundWorker(
  context: BrowserContext
): Promise<Worker> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const candidates = context
      .serviceWorkers()
      .filter((sw) => sw.url().startsWith("chrome-extension://"))
    for (const sw of candidates) {
      if (await isOurBackgroundWorker(sw)) return sw
    }

    try {
      await context.waitForEvent("serviceworker", {
        timeout: 2000,
        predicate: (sw) => sw.url().startsWith("chrome-extension://"),
      })
    } catch {
      void 0
    }
  }

  const seenWorkerUrls = context.serviceWorkers().map((sw) => sw.url())
  throw new Error(
    `Failed to locate ${BACKGROUND_WORKER_NAME} service worker. Seen workers: ${JSON.stringify(seenWorkerUrls)}`
  )
}

/**
 * Wait for the deterministic build's background initialization barrier before
 * writing test-only integration enablement. The message atomically persists
 * the temporary profile and updates the worker's in-memory matcher before a
 * mocked page navigation can begin.
 */
async function initializeDeterministicMockProfile(
  context: BrowserContext,
  extensionId: string,
  enablement: Record<string, boolean>
): Promise<void> {
  const probePage = await context.newPage()
  try {
    await probePage.goto(`chrome-extension://${extensionId}/options.html`, {
      waitUntil: "domcontentloaded",
    })

    let lastError: unknown
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const response = await probePage.evaluate(
          async (payload) => {
            return await chrome.runtime.sendMessage({
              type: payload.messageType,
              payload: {
                downloadQueue: [],
                siteIntegrationEnablement: payload.enablement,
              },
            })
          },
          { messageType: E2E_SEED_DOWNLOAD_QUEUE_MESSAGE, enablement }
        )

        if (
          response &&
          typeof response === "object" &&
          "success" in response &&
          response.success === true
        ) {
          return
        }

        throw new Error(
          `Deterministic E2E background initialization failed: ${JSON.stringify(response)}`
        )
      } catch (error) {
        lastError = error
        // The MV3 worker can be observable a few milliseconds before main()
        // installs the test-only seed listener. Retry only this bootstrap race.
        if (
          !(error instanceof Error) ||
          !error.message.includes("Receiving end does not exist")
        ) {
          throw error
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    throw lastError
  } finally {
    await probePage.close()
  }
}

/**
 * Shared context + fixture state for a single test. Fixtures hand
 * instances of this down through `context`/`extensionId` so teardown can
 * run in reverse setup order (DNR rules cleared → local server closed →
 * Chromium closed → user-data dir removed).
 */
interface ExtensionContextState {
  context: BrowserContext
  extensionId: string
  backgroundWorker: Worker
  localMockServer: LocalMockServerHandle | null
  userDataDir: string
  teardown: () => Promise<void>
}

export interface ExtensionContextResources {
  context?: BrowserContext
  backgroundWorker?: Worker
  localMockServer: LocalMockServerHandle | null
  userDataDir: string
  dnrRulesToInstall: DnrRedirectRule[]
}

/**
 * Tear down both fully initialized and partially initialized fixture state.
 * Setup failures can occur after the temp profile or mock server exists but
 * before Playwright exposes the extension worker, so cleanup must not depend
 * on a completed `ExtensionContextState`.
 */
export async function teardownExtensionResources(
  resources: ExtensionContextResources
): Promise<void> {
  const errors: Error[] = []
  const {
    context,
    backgroundWorker,
    localMockServer,
    userDataDir,
    dnrRulesToInstall,
  } = resources

  if (dnrRulesToInstall.length > 0 && backgroundWorker) {
    try {
      await clearDnrRedirectRules(backgroundWorker)
    } catch (error) {
      errors.push(error as Error)
      console.warn("[extension.fixture] failed to clear DNR test rules:", error)
    }
  }

  if (context) {
    // Collect coverage from background/side-panels/etc before closing context.
    try {
      await collectContextCoverage(context, backgroundWorker)
    } catch (error) {
      errors.push(error as Error)
      console.warn(
        "[extension.fixture] failed to collect extension coverage:",
        error
      )
    }
    try {
      await context.close()
    } catch (error) {
      errors.push(error as Error)
      console.warn("[extension.fixture] failed to close context:", error)
    }
  }

  if (localMockServer) {
    try {
      await localMockServer.close()
    } catch (error) {
      errors.push(error as Error)
      console.warn("[extension.fixture] failed to close mock server:", error)
    }
  }

  try {
    await fs.rm(userDataDir, { recursive: true, force: true })
  } catch (error) {
    errors.push(error as Error)
    console.warn("[extension.fixture] failed to remove userDataDir:", error)
  }

  if (errors.length > 0) {
    throw new Error(
      `Teardown failed with ${errors.length} errors: ${errors.map((error) => error.message).join(", ")}`
    )
  }
}

async function setupExtensionContext(
  testInfoHeadless: boolean
): Promise<ExtensionContextState> {
  const userDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "tmd-playwright-")
  )

  // Phase 3 download-workflow specs need to intercept offscreen-initiated
  // fetches. Playwright's context.route doesn't cover those, so we spin up
  // a local HTTP mock server and install DNR redirect rules later to
  // steer specific external URLs at it.
  let localMockServer: LocalMockServerHandle | null = null
  let dnrRulesToInstall: DnrRedirectRule[] = []
  let contextForCleanup: BrowserContext | undefined
  let backgroundWorkerForCleanup: Worker | undefined

  try {
    if (shouldUseMockRoutes) {
      localMockServer = await startLocalMockServer()
      dnrRulesToInstall = [
        ...registerMangadexLocalServerHandlers(localMockServer),
        ...registerManhuaguiLocalServerHandlers(localMockServer),
        ...registerPixivComicLocalServerHandlers(localMockServer),
        ...registerShonenJumpPlusLocalServerHandlers(localMockServer),
        ...registerComicNettaiLocalServerHandlers(localMockServer),
      ]
    }

    const context = await chromium.launchPersistentContext(userDataDir, {
      // The extension manifest targets Chrome 150+. Playwright 1.61's default
      // Chromium is 149, so use its hermetic tip-of-tree channel (currently
      // Chrome for Testing 151) by default instead of waiting for an
      // incompatible browser to time out while attempting to load the extension.
      channel: e2eBrowserChannel,
      headless: testInfoHeadless,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        "--no-sandbox",
        "--no-focus-on-launch",
        "--lang=en-US",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
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
        "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests",
      ],
    })
    contextForCleanup = context
    installCoverageHooks(context)

    if (!shouldUseMockRoutes && !shouldAllowNetwork) {
      throw new Error(
        "Invalid E2E route policy: both TMD_TEST_E2E_USE_MOCKS and TMD_TEST_E2E_ALLOW_NETWORK are false. " +
          "Enable mock routes for deterministic E2E or allow network for live E2E."
      )
    }

    await registerTestRoutes(
      context,
      {
        useMocks: shouldUseMockRoutes,
        allowNetwork: shouldAllowNetwork,
      },
      localMockServer ? [localMockServer.url] : []
    )

    const backgroundWorker = await resolveBackgroundWorker(context)
    backgroundWorkerForCleanup = backgroundWorker

    if (process.env.TMD_TEST_E2E_DIAG === "true") {
      backgroundWorker.on("console", (message) => {
        console.log("[background console]", message.type(), message.text())
      })
    }

    // Parse from worker URL first; avoids evaluate races with suspended MV3 workers.
    let extensionId = backgroundWorker.url().split("/")[2] || ""
    if (!extensionId) {
      try {
        extensionId = await backgroundWorker.evaluate(() => chrome.runtime.id)
      } catch {
        extensionId = ""
      }
    }
    if (!extensionId) {
      throw new Error(
        "Resolved service worker but failed to derive extension ID"
      )
    }

    if (shouldUseMockRoutes) {
      const mockEnablement = Object.fromEntries(
        SITE_INTEGRATION_MANIFESTS.filter((manifest) => manifest.shipped).map(
          (manifest) => [manifest.id, true]
        )
      )
      await initializeDeterministicMockProfile(
        context,
        extensionId,
        mockEnablement
      )
    }

    if (shouldEnableLiveIntegrations) {
      const liveEnablement = Object.fromEntries(
        SITE_INTEGRATION_MANIFESTS.filter((manifest) => manifest.shipped).map(
          (manifest) => [manifest.id, true]
        )
      )
      const liveHarnessState = await backgroundWorker.evaluate(
        async ({ enablement, wildcardOrigin }) => {
          const hasWildcardPermission = await chrome.permissions.contains({
            origins: [wildcardOrigin],
          })
          if (!hasWildcardPermission) {
            throw new Error(
              "The live-test extension build is missing its isolated wildcard host permission"
            )
          }

          await chrome.storage.local.set({
            siteIntegrationEnablement: enablement,
          })
          return { hasWildcardPermission, enablement }
        },
        {
          enablement: liveEnablement,
          wildcardOrigin: "https://*/*",
        }
      )

      if (
        !liveHarnessState.hasWildcardPermission ||
        Object.values(liveHarnessState.enablement).some((enabled) => !enabled)
      ) {
        throw new Error(
          "Failed to initialize the live integration test profile"
        )
      }
    }

    if (dnrRulesToInstall.length > 0) {
      await installDnrRedirectRules(
        backgroundWorker,
        extensionId,
        dnrRulesToInstall
      )
    }

    const teardown = async (): Promise<void> =>
      teardownExtensionResources({
        context,
        backgroundWorker,
        localMockServer,
        userDataDir,
        dnrRulesToInstall,
      })

    return {
      context,
      extensionId,
      backgroundWorker,
      localMockServer,
      userDataDir,
      teardown,
    }
  } catch (setupError) {
    try {
      await teardownExtensionResources({
        context: contextForCleanup,
        backgroundWorker: backgroundWorkerForCleanup,
        localMockServer,
        userDataDir,
        dnrRulesToInstall,
      })
    } catch (cleanupError) {
      throw new AggregateError(
        [setupError, cleanupError],
        "Extension test fixture setup failed and partial-resource cleanup also failed",
        { cause: cleanupError }
      )
    }
    throw setupError
  }
}

export const test = base.extend<{
  context: BrowserContext
  extensionId: string
  page: Page
  _extensionContextState: ExtensionContextState
}>({
  // eslint-disable-next-line no-empty-pattern
  _extensionContextState: async ({}, use, testInfo) => {
    // Chromium does not expose a loadable MV3 extension worker through the
    // headless shell used by this test channel. E2E configurations therefore
    // default to headed mode (CI supplies Xvfb); callers can still opt in to
    // headed explicitly without changing fixture behavior.
    const headless = testInfo.project.use.headless ?? false
    const state = await setupExtensionContext(headless)
    try {
      await use(state)
    } finally {
      await state.teardown()
    }
  },

  context: async ({ _extensionContextState }, use) => {
    await use(_extensionContextState.context)
  },

  extensionId: async ({ _extensionContextState }, use) => {
    await use(_extensionContextState.extensionId)
  },

  page: async ({ context }, use) => {
    // Reuse the first page that launchPersistentContext creates
    // This prevents creating unnecessary tabs (launchPersistentContext already opens one tab)
    const page = context.pages()[0] || (await context.newPage())

    // Opt-in E2E diagnostics for tracing page and mock-route failures.
    if (process.env.TMD_TEST_E2E_DIAG === "true") {
      page.on("console", (msg) => {
        console.log("[page console]", msg.type(), msg.text())
      })
      page.on("pageerror", (err) => {
        console.log("[page error]", err.message)
      })
      page.on("request", (req) => {
        console.log(
          "[page request]",
          req.method(),
          req.url(),
          "resourceType=",
          req.resourceType()
        )
      })
      page.on("response", (res) => {
        console.log("[page response]", res.status(), res.url())
      })
      page.on("requestfailed", (req) => {
        console.log("[page requestfailed]", req.url(), req.failure()?.errorText)
      })
    }

    await use(page)

    // Don't close the page - let context manage it
  },
})

export const expect = test.expect
