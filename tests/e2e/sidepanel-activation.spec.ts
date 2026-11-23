import { test, expect, resolveBackgroundWorker } from "./fixtures/extension"
import {
  getTabId,
  seedTabContext,
  openSidepanelHarness,
  openSidepanelViaChromeApi,
  setLocalState,
  setSessionState,
} from "./fixtures/state-helpers"
import {
  SESSION_STORAGE_KEYS,
  SETTINGS_STORAGE_KEYS,
} from "@/src/runtime/storage-keys"
import { DEFAULT_SETTINGS } from "@/src/domain/settings/defaults"
import {
  MANGADEX_TEST_SERIES_URL,
  buildExampleUrl,
} from "./fixtures/test-domains-constants"

async function getActionTitle(
  context: import("@playwright/test").BrowserContext,
  tabId: number
): Promise<string> {
  const worker = await resolveBackgroundWorker(context)
  return await worker.evaluate(async (id: number) => {
    try {
      return await chrome.action.getTitle({ tabId: id })
    } catch {
      return ""
    }
  }, tabId)
}

async function isActionEnabled(
  context: import("@playwright/test").BrowserContext,
  tabId: number
): Promise<boolean> {
  const worker = await resolveBackgroundWorker(context)
  return await worker.evaluate(async (id: number) => {
    try {
      return await chrome.action.isEnabled(id)
    } catch {
      return false
    }
  }, tabId)
}

async function waitForActionTitle(
  context: import("@playwright/test").BrowserContext,
  tabId: number,
  expectedSubstring: string,
  timeoutMs: number = 5000
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const title = await getActionTitle(context, tabId)
    if (title.includes(expectedSubstring)) {
      return title
    }
    await context.pages()[0]?.waitForTimeout(100)
  }
  const finalTitle = await getActionTitle(context, tabId)
  throw new Error(
    `Timeout waiting for action title to include "${expectedSubstring}" (last title: "${finalTitle}")`
  )
}

async function waitForSidepanelSeries(
  page: import("@playwright/test").Page,
  seriesTitle: string,
  timeoutMs: number = 15000
): Promise<void> {
  await page.waitForFunction(
    async ({ title }) => {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      if (typeof activeTab?.windowId !== "number") return false

      const result = await chrome.storage.session.get(
        "activeTabContextByWindow"
      )
      const byWindow = result.activeTabContextByWindow as
        Record<number, { context?: { seriesTitle?: string } }> | undefined
      return byWindow?.[activeTab.windowId]?.context?.seriesTitle === title
    },
    { title: seriesTitle },
    { timeout: timeoutMs }
  )
}

test.describe("Side Panel activation", () => {
  test("shows an animated startup indicator and honors reduced motion", async ({
    extensionId,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" })
    const { promise, resolve } = Promise.withResolvers<void>()
    let scriptHeld = false
    await page.route(`chrome-extension://${extensionId}/**`, async (route) => {
      if (route.request().resourceType() === "script") {
        scriptHeld = true
        await promise
      }
      await route.continue()
    })

    const loading = page.getByRole("status").filter({ hasText: "Loading Tako" })
    const isAnimating = () =>
      loading.evaluate((node) =>
        node
          .getAnimations({ subtree: true })
          .some((animation) => animation.playState === "running")
      )
    try {
      await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
        waitUntil: "commit",
      })
      await expect.poll(() => scriptHeld).toBe(true)
      await expect(loading).toBeVisible()
      await expect.poll(isAnimating).toBe(true)

      await page.emulateMedia({ reducedMotion: "reduce" })
      await expect.poll(isAnimating).toBe(false)
      await expect(loading).toBeVisible()
    } finally {
      resolve()
    }

    await expect(page.getByRole("tab", { selected: true })).toBeVisible()
    await expect(loading).toHaveCount(0)
  })

  test("shows the panel while saved UI preferences are still loading", async ({
    context,
    extensionId,
    page,
  }) => {
    await setLocalState(context, SETTINGS_STORAGE_KEYS.global, {
      ...DEFAULT_SETTINGS,
      uiLanguage: "ja",
      motionPreference: "system",
    })
    await page.addInitScript(() => {
      const { promise, resolve } = Promise.withResolvers<void>()
      window.addEventListener("release-ui-preferences", () => resolve(), {
        once: true,
      })
      const send = chrome.runtime.sendMessage.bind(chrome.runtime)
      Object.defineProperty(chrome.runtime, "sendMessage", {
        value: async (message: { type: string }) => {
          const response = await send(message)
          if (message.type === "GET_UI_PREFERENCES") await promise
          return response
        },
      })
    })
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)

    const queueTab = page.getByRole("tab", { selected: true })
    await expect(queueTab).toBeVisible()
    await expect(page.getByRole("banner").getByRole("button")).toBeEnabled()
    const html = page.locator("html")
    await expect(html).toHaveAttribute("data-tako-motion", "reduce")

    await page.evaluate(() =>
      window.dispatchEvent(new Event("release-ui-preferences"))
    )
    await expect(queueTab).toHaveText("キュー")
    await expect(html).toHaveAttribute("lang", "ja")
    await expect(html).not.toHaveAttribute("data-tako-motion")
  })

  test("opens side panel on supported series page and keeps the action enabled", async ({
    context,
    extensionId,
    page,
  }) => {
    // Navigate to a supported series page (mangadex)
    await page.goto(MANGADEX_TEST_SERIES_URL, {
      waitUntil: "domcontentloaded",
    })

    const baseChapters = [
      { id: "chapter-1", url: "https://example.com/ch1", title: "Chapter 1" },
      { id: "chapter-2", url: "https://example.com/ch2", title: "Chapter 2" },
    ]

    const tabId = await seedTabContext(
      page,
      context,
      {
        siteIntegrationId: "mangadex",
        mangaId: "db692d58-4b13-4174-ae8c-30c515c0689c",
        seriesTitle: "Hunter x Hunter",
        chapters: baseChapters,
      },
      MANGADEX_TEST_SERIES_URL
    )

    // The background should have enabled the action and set supported title
    const title = await waitForActionTitle(context, tabId, "Supported")
    expect(title).toContain("Supported")
    await expect.poll(async () => isActionEnabled(context, tabId)).toBe(true)

    const actualPanel = await openSidepanelViaChromeApi(
      context,
      extensionId,
      tabId
    )
    test.skip(
      !actualPanel.supported,
      "This Chromium channel does not expose chrome.sidePanel.open."
    )
    expect(actualPanel.error).toBeNull()

    // Use a normal page harness for DOM assertions after exercising the actual
    // Chrome side-panel API above; Playwright cannot inspect side-panel targets.
    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()
    await waitForSidepanelSeries(sp, "Hunter x Hunter")
    await sp.getByRole("tab", { name: "Manga", exact: true }).click()
    await expect(sp.getByText("Hunter x Hunter")).toBeVisible({
      timeout: 10000,
    })
    // Series-aware card should be present with a "Select chapters" control
    await expect(
      sp.getByRole("tab", { name: "Manga", exact: true })
    ).toBeVisible()
    await sp.close()
  })

  test("keeps action enabled on unsupported page and reports unsupported title", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(buildExampleUrl("/"), { waitUntil: "domcontentloaded" })
    const tabId = await getTabId(page, context)

    const title = await waitForActionTitle(context, tabId, "Unsupported")
    expect(title).toContain("Unsupported")
    await expect.poll(async () => isActionEnabled(context, tabId)).toBe(true)

    // Open Side Panel for this active unsupported tab and assert Command Center renders
    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()
    // On unsupported pages, the series region shows a compact no-series guidance state
    await expect(
      sp.getByRole("tab", { name: "Queue", exact: true })
    ).toHaveAttribute("aria-selected", "true")
    await expect(sp.getByRole("tab", { name: "Manga" })).toHaveCount(0)
    await sp.close()
  })

  test("updates the focused settings button when an update appears and clears", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(buildExampleUrl("/"), { waitUntil: "domcontentloaded" })
    await getTabId(page, context)
    const sp = await openSidepanelHarness(context, extensionId, page)
    const settings = sp.getByRole("button", { name: /^Open Options/ })
    await settings.focus()
    await expect(settings).toBeFocused()

    await setSessionState(context, SESSION_STORAGE_KEYS.optionsActionItems, {
      extensionUpdate: {
        status: "available",
        version: "1.2.8",
        detectedAt: Date.now(),
      },
    })

    await expect(
      sp.getByRole("button", { name: "Open Options (Action item available)" })
    ).toBeFocused()
    const indicator = sp.getByTestId("options-action-indicator")
    await expect(indicator).toBeVisible()
    await expect(sp.getByRole("button", { name: "Apply Update" })).toHaveCount(
      0
    )

    await setSessionState(context, SESSION_STORAGE_KEYS.optionsActionItems, {})
    await expect(indicator).toHaveCount(0)
    await expect(settings).toBeFocused()
    await sp.close()
  })
  test("opens Options from the settings button", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(buildExampleUrl("/"), { waitUntil: "domcontentloaded" })
    await getTabId(page, context)

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()

    const optionsPagePromise = context.waitForEvent("page", {
      predicate: (targetPage) =>
        targetPage
          .url()
          .startsWith(`chrome-extension://${extensionId}/options.html`),
      timeout: 10000,
    })

    const settingsButton = sp.getByRole("button", { name: /Open Options/i })
    await expect(settingsButton).toBeVisible()
    await settingsButton.click()

    const optionsPage = await optionsPagePromise
    await expect(optionsPage.locator("#root")).toBeVisible({ timeout: 10000 })
    await expect(optionsPage.getByText("Tako Settings")).toBeVisible()

    await sp.close()
    await optionsPage.close()
  })

  test("shows an unavailable folder above an update and keeps the update when the destination changes", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(buildExampleUrl("/"), { waitUntil: "domcontentloaded" })
    const sp = await openSidepanelHarness(context, extensionId, page)
    const indicator = sp.getByTestId("options-action-indicator")
    await setSessionState(context, SESSION_STORAGE_KEYS.optionsActionItems, {
      extensionUpdate: { status: "available", detectedAt: Date.now() },
    })
    await expect(indicator).toHaveAttribute("data-severity", "warning")

    const settings = { ...DEFAULT_SETTINGS, uiLanguage: "en" }
    await setLocalState(context, SETTINGS_STORAGE_KEYS.global, {
      ...settings,
      downloads: {
        ...settings.downloads,
        destination: "file-system-access",
        customDirectoryHandleId: "missing-folder",
      },
    })
    await expect(indicator).toHaveAttribute("data-severity", "error")

    await setLocalState(context, SETTINGS_STORAGE_KEYS.global, settings)
    await expect(indicator).toHaveAttribute("data-severity", "warning")
    await sp.close()
  })

  test("shows unsupported message on about:blank", async ({
    context,
    extensionId,
  }) => {
    // Navigate to about:blank
    const page = await context.newPage()
    await page.goto("about:blank")

    await getTabId(page, context)

    // Open Side Panel for this about:blank tab
    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()

    // Should show no-series guidance for about:blank
    await expect(
      sp.getByRole("tab", { name: "Queue", exact: true })
    ).toHaveAttribute("aria-selected", "true")

    await sp.close()
    await page.close()
  })

  test("keeps the Side Panel open when switching to an unsupported tab", async ({
    context,
    extensionId,
  }) => {
    // Create an unsupported tab
    const unsupportedPage = await context.newPage()
    await unsupportedPage.goto(buildExampleUrl("/"), {
      waitUntil: "domcontentloaded",
    })
    const unsupportedTabId = await getTabId(unsupportedPage, context)
    await waitForActionTitle(context, unsupportedTabId, "Unsupported")

    // Create a supported tab
    const supportedPage = await context.newPage()
    await supportedPage.goto(MANGADEX_TEST_SERIES_URL, {
      waitUntil: "domcontentloaded",
    })

    const baseChapters = [
      { id: "chapter-1", url: "https://example.com/ch1", title: "Chapter 1" },
    ]

    const supportedTabId = await seedTabContext(
      supportedPage,
      context,
      {
        siteIntegrationId: "mangadex",
        // MangaDex emits the bare title UUID as its canonical series identity.
        mangaId: "db692d58-4b13-4174-ae8c-30c515c0689c",
        seriesTitle: "Hunter x Hunter",
        chapters: baseChapters,
      },
      MANGADEX_TEST_SERIES_URL
    )

    const actualPanel = await openSidepanelViaChromeApi(
      context,
      extensionId,
      supportedTabId
    )
    expect(actualPanel.supported).toBe(true)
    expect(actualPanel.error).toBeNull()
    await supportedPage.bringToFront()

    const worker = await resolveBackgroundWorker(context)
    const panelContexts = () =>
      worker.evaluate(() =>
        chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })
      )
    await expect.poll(async () => (await panelContexts()).length).toBe(1)
    const [panel] = await panelContexts()
    expect(panel.documentId).toBeDefined()

    const sp = await openSidepanelHarness(context, extensionId, supportedPage)
    const mangaTab = sp.getByRole("tab", { name: "Manga", exact: true })
    const queueTab = sp.getByRole("tab", { name: "Queue", selected: true })
    const queuePanel = sp.locator("#panel-view-queue")
    await sp.emulateMedia({ reducedMotion: "no-preference" })
    await mangaTab.click()
    await expect(sp.getByText("Hunter x Hunter")).toBeVisible()

    await unsupportedPage.bringToFront()
    await expect(queueTab).toBeVisible()
    await expect(mangaTab).toHaveCount(0)
    // Views render immediately: no entrance animation even under no-preference.
    await expect(queuePanel).toHaveCSS("animation-name", "none")
    expect(await panelContexts()).toEqual([panel])

    await supportedPage.bringToFront()
    await mangaTab.click()
    await expect(sp.getByText("Hunter x Hunter")).toBeVisible()
    await sp.emulateMedia({ reducedMotion: "reduce" })
    await supportedPage.goto(buildExampleUrl("/unsupported"), {
      waitUntil: "domcontentloaded",
    })
    await expect(queueTab).toBeVisible()
    await expect(mangaTab).toHaveCount(0)
    await expect(queuePanel).toHaveCSS("animation-name", "none")
    expect(await panelContexts()).toEqual([panel])

    await sp.close()
    await supportedPage.close()
    await unsupportedPage.close()
  })

  test("shows disabled no-chapters button when active series has zero chapters", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(MANGADEX_TEST_SERIES_URL, {
      waitUntil: "domcontentloaded",
    })

    await seedTabContext(
      page,
      context,
      {
        siteIntegrationId: "mangadex",
        mangaId: "test-series-no-chapters",
        seriesTitle: "No Chapters Test Series",
        chapters: [],
      },
      MANGADEX_TEST_SERIES_URL
    )

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()
    await waitForSidepanelSeries(sp, "No Chapters Test Series")
    await sp.getByRole("tab", { name: "Manga", exact: true }).click()
    await expect(sp.getByText("No Chapters Test Series")).toBeVisible({
      timeout: 10000,
    })
    await expect(sp.getByText(/No chapters found/i)).toBeVisible()

    const disabledNoChaptersButton = sp.getByRole("button", {
      name: /Download/i,
    })
    await expect(disabledNoChaptersButton).toBeVisible()
    await expect(disabledNoChaptersButton).toBeDisabled()

    await sp.close()
  })

  test("sliding tab indicator tracks pointer and keyboard selection", async ({
    context,
    extensionId,
    page,
  }) => {
    test.setTimeout(90_000)
    await page.goto(buildExampleUrl("/"), { waitUntil: "domcontentloaded" })
    await page.bringToFront()
    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()
    await sp.emulateMedia({ reducedMotion: "no-preference" })
    await expect(sp.locator("html")).not.toHaveAttribute("data-tako-motion")

    const measure = () =>
      sp.evaluate(() => {
        const indicator = document.querySelector(".panel-tab-indicator")
        const selected = document.querySelector(
          '[role="tab"][aria-selected="true"]'
        )
        if (!indicator || !selected) return null
        const i = indicator.getBoundingClientRect()
        const b = selected.getBoundingClientRect()
        return {
          aligned:
            Math.abs(i.left - b.left) <= 1 &&
            Math.abs(i.right - b.right) <= 1 &&
            Math.abs(i.bottom - b.bottom) <= 1,
          running: indicator
            .getAnimations()
            .some(
              (a) =>
                a instanceof CSSTransition &&
                a.transitionProperty === "transform" &&
                a.playState === "running"
            ),
        }
      })

    // Arm a transitionrun counter so a finished transition is still observed.
    await sp.evaluate(() => {
      const w = window as unknown as { __indRuns?: number }
      w.__indRuns = 0
      document
        .querySelector(".panel-tab-indicator")
        ?.addEventListener("transitionrun", (event) => {
          if ((event as TransitionEvent).propertyName === "transform")
            w.__indRuns = (w.__indRuns ?? 0) + 1
        })
    })

    // (a) Pointer selection animates the indicator, then aligns.
    await sp.getByRole("tab", { name: "Recent", exact: true }).click()
    await expect
      .poll(async () =>
        sp.evaluate(
          () => (window as unknown as { __indRuns?: number }).__indRuns ?? 0
        )
      )
      .toBeGreaterThan(0)
    await expect
      .poll(async () => (await measure())?.running ?? true)
      .toBe(false)
    expect((await measure())?.aligned).toBe(true)

    // (b) Keyboard selection snaps: no animation on the next frame.
    await sp.getByRole("tab", { name: "Recent", exact: true }).focus()
    await sp.keyboard.press("ArrowLeft")
    const animationsNextFrame = await sp.evaluate(
      () =>
        new Promise<number>((resolve) =>
          requestAnimationFrame(() =>
            resolve(
              document.querySelector(".panel-tab-indicator")?.getAnimations()
                .length ?? -1
            )
          )
        )
    )
    expect(animationsNextFrame).toBe(0)
    await expect
      .poll(async () => (await measure())?.aligned ?? false)
      .toBe(true)

    // (d) Reduced motion: selection stays aligned with no running animation.
    await sp.emulateMedia({ reducedMotion: "reduce" })
    await expect
      .poll(() =>
        sp.evaluate(
          () => matchMedia("(prefers-reduced-motion: reduce)").matches
        )
      )
      .toBe(true)
    await sp.getByRole("tab", { name: "Recent", exact: true }).click()
    // The base stylesheet gives every element a ~0.01ms `transition: all`
    // fallback; only a real (>=50ms) running animation counts as motion.
    const reduceAnimations = await sp.evaluate(
      () =>
        new Promise<number>((resolve) =>
          requestAnimationFrame(() =>
            resolve(
              document
                .querySelector(".panel-tab-indicator")
                ?.getAnimations()
                .filter(
                  (a) =>
                    a.playState === "running" &&
                    (Number(a.effect?.getComputedTiming().duration) || 0) >= 50
                ).length ?? -1
            )
          )
        )
    )
    expect(reduceAnimations).toBe(0)
    await expect
      .poll(async () => (await measure())?.aligned ?? false)
      .toBe(true)

    await sp.close()
  })

  test("tab indicator aligns under every tab with Manga present at narrow widths", async ({
    context,
    extensionId,
    page,
  }) => {
    test.setTimeout(90_000)
    await page.goto(MANGADEX_TEST_SERIES_URL, {
      waitUntil: "domcontentloaded",
    })
    await page.bringToFront()
    await seedTabContext(
      page,
      context,
      {
        siteIntegrationId: "mangadex",
        mangaId: "db692d58-4b13-4174-ae8c-30c515c0689c",
        seriesTitle: "Hunter x Hunter",
        chapters: [
          {
            id: "chapter-1",
            url: "https://example.com/ch1",
            title: "Chapter 1",
          },
        ],
      },
      MANGADEX_TEST_SERIES_URL
    )
    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()
    await sp.emulateMedia({ reducedMotion: "no-preference" })
    await expect(
      sp.getByRole("tab", { name: "Manga", exact: true })
    ).toBeVisible()

    const measure = () =>
      sp.evaluate(() => {
        const indicator = document.querySelector(".panel-tab-indicator")
        const selected = document.querySelector(
          '[role="tab"][aria-selected="true"]'
        )
        if (!indicator || !selected) return null
        const i = indicator.getBoundingClientRect()
        const b = selected.getBoundingClientRect()
        return {
          aligned:
            Math.abs(i.left - b.left) <= 1 &&
            Math.abs(i.right - b.right) <= 1 &&
            Math.abs(i.bottom - b.bottom) <= 1,
        }
      })

    for (const width of [200, 480]) {
      await sp.setViewportSize({ width, height: 800 })
      for (const tab of ["Queue", "Manga", "Recent"]) {
        await sp.getByRole("tab", { name: tab, exact: true }).click()
        // Wait out the indicator transition, then check alignment.
        await expect
          .poll(async () => {
            const ind = await sp.evaluate(
              () =>
                document
                  .querySelector(".panel-tab-indicator")
                  ?.getAnimations()
                  .filter((a) => a.playState === "running").length ?? 0
            )
            return ind
          })
          .toBe(0)
        expect((await measure())?.aligned).toBe(true)
      }
    }

    await sp.close()
  })
})
