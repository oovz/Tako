import { test, expect } from "./fixtures/extension"
import {
  getSessionState,
  getTabId,
  openSidepanelHarness,
} from "./fixtures/state-helpers"
import {
  BASIC_SERIES,
  BASIC_SERIES_PAGE_HTML,
} from "./fixtures/mock-data/site-integrations/readmanga"
import { MANHUAGUI_LOCAL_PREFIX } from "./fixtures/mock-data/site-integrations/readmanga/local-server"
import { MANHUAGUI_BASE_URL } from "./fixtures/test-domains-constants"

for (const recovery of ["automatic", "user retry"] as const) {
  test(`series context recovers through ${recovery} after provider failure`, async ({
    context,
    page,
    extensionId,
    _extensionContextState,
  }) => {
    const server = _extensionContextState.localMockServer
    expect(server).not.toBeNull()
    let available = false
    let retryWasClicked: (() => Promise<boolean>) | undefined
    let requests = 0
    let retryResult = Promise.withResolvers<boolean>()
    server!.addRoute(
      `${MANHUAGUI_LOCAL_PREFIX}/comic/${BASIC_SERIES.series.seriesId}`,
      async () => {
        requests += 1
        const providerAvailable =
          (await retryWasClicked?.()) === true
            ? await retryResult.promise
            : available
        return {
          status: providerAvailable ? 200 : 503,
          headers: { "content-type": "text/html; charset=utf-8" },
          body: providerAvailable
            ? BASIC_SERIES_PAGE_HTML
            : "Provider temporarily unavailable",
        }
      }
    )
    await page.goto(
      `${MANHUAGUI_BASE_URL}/comic/${BASIC_SERIES.series.seriesId}/`,
      { waitUntil: "load" }
    )
    const tabId = await getTabId(page, context)
    await expect
      .poll(() => getSessionState(context, `seriesContextError_${tabId}`))
      .toBeTruthy()
    const initialRequests = requests
    expect(initialRequests).toBeGreaterThan(0)
    if (recovery === "automatic") available = true
    const sidepanel = await openSidepanelHarness(context, extensionId, page)
    const mangaTab = sidepanel.getByRole("tab", { name: "Manga", exact: true })
    const manga = sidepanel.getByRole("tabpanel", { name: "Manga" })
    try {
      await mangaTab.click()
      if (recovery === "user retry") {
        await expect.poll(() => requests).toBeGreaterThan(initialRequests)
        const retry = manga.getByRole("button", { name: "Retry", exact: true })
        await expect(retry).toBeVisible()
        // Hold only requests issued after the retry action, leaving automatic recovery free to settle.
        await sidepanel.evaluate(() => {
          document.addEventListener(
            "click",
            (event) => {
              if (
                event.isTrusted &&
                event.target instanceof Element &&
                event.target.closest("button")?.textContent?.trim() === "Retry"
              ) {
                document.documentElement.dataset.playwrightSeriesRetry =
                  "clicked"
              }
            },
            { capture: true }
          )
        })
        retryWasClicked = () =>
          sidepanel.evaluate(
            () =>
              document.documentElement.dataset.playwrightSeriesRetry ===
              "clicked"
          )
        for (const succeeds of [false, true]) {
          const beforeRetry = requests
          await retry.press("Enter")
          await expect.poll(() => requests).toBeGreaterThan(beforeRetry)
          const retrying = manga.getByRole("button", {
            name: "Retrying…",
            exact: true,
          })
          await expect(retrying).toBeFocused()
          await expect(retrying).toBeDisabled()
          await expect(mangaTab).toHaveAttribute("aria-selected", "true")
          await expect(manga.getByRole("checkbox")).toHaveCount(0)
          retryResult.resolve(succeeds)
          if (!succeeds) {
            await expect(retry).toBeEnabled()
            await expect(retry).toBeFocused()
            retryResult = Promise.withResolvers<boolean>()
          }
        }
        await expect(
          manga.getByRole("checkbox", {
            name: "Select all",
            exact: true,
          })
        ).toBeFocused()
      }
      await expect(
        manga.getByRole("heading", { name: BASIC_SERIES.series.seriesTitle })
      ).toBeVisible({ timeout: 15_000 })
    } finally {
      retryResult.resolve(false)
    }
    await expect
      .poll(async () => {
        const state = await getSessionState<{
          seriesTitle?: string
          chapters?: unknown[]
          chaptersLoading?: boolean
        }>(context, `tab_${tabId}`)
        return (
          state?.seriesTitle === BASIC_SERIES.series.seriesTitle &&
          state?.chaptersLoading !== true &&
          (state.chapters?.length ?? 0) > 0
        )
      })
      .toBe(true)
    const recoveryRequests = requests - initialRequests
    expect(recoveryRequests).toBeGreaterThanOrEqual(1)
    expect(
      await getSessionState(context, `seriesContextError_${tabId}`)
    ).toBeUndefined()
  })
}
