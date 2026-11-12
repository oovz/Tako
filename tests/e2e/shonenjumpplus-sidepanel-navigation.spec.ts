import { test, expect } from "./fixtures/extension"
import {
  getTabId,
  openMangaSidepanelHarness,
  openSidepanelHarness,
  waitForTabSeriesTitle,
  waitForTabStateCleared,
} from "./fixtures/state-helpers"
import { SHONENJUMPPLUS_BASE_URL } from "./fixtures/test-domains-constants"
import { ShonenJumpPlus } from "./fixtures/mock-data"
import { SHONENJUMPPLUS_LOCAL_SITE_PREFIX } from "./fixtures/mock-data/site-integrations/shonenjumpplus/local-server"

test.describe("Shonen Jump+ navigation", () => {
  test("opens Manga while the chapter catalog is pending", async ({
    context,
    extensionId,
    page,
    _extensionContextState,
  }) => {
    const server = _extensionContextState.localMockServer
    if (!server) throw new Error("Shonen Jump+ mock server is unavailable")
    const { promise: release, resolve } = Promise.withResolvers<void>()
    let requested = false
    server.addRoute(
      `${SHONENJUMPPLUS_LOCAL_SITE_PREFIX}/api/viewer/readable_product_pagination_information`,
      async ({ url }) => {
        requested = true
        await release
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: ShonenJumpPlus.buildReadableProductPaginationInfoResponse(
            url.searchParams.get("aggregate_id") ?? ""
          ),
        }
      }
    )
    await page.goto(SHONENJUMPPLUS_BASE_URL, { waitUntil: "domcontentloaded" })
    const panel = await openSidepanelHarness(context, extensionId, page)
    try {
      const queueTab = panel.getByRole("tab", { name: "Queue", exact: true })
      const mangaTab = panel.getByRole("tab", { name: "Manga", exact: true })
      const mangaView = panel.getByRole("tabpanel", { name: "Manga" })
      const progress = mangaView
        .getByRole("status")
        .filter({ hasText: "Loading manga info…" })
      await expect(queueTab).toHaveAttribute("aria-selected", "true")
      await expect(mangaTab).toHaveCount(0)
      const { seriesId, seriesTitle } = ShonenJumpPlus.BASIC_SERIES.series
      await page.bringToFront()
      await page.goto(`${SHONENJUMPPLUS_BASE_URL}/episode/${seriesId}`, {
        waitUntil: "domcontentloaded",
      })
      await expect.poll(() => requested).toBe(true)
      await expect(queueTab).toHaveAttribute("aria-selected", "true")
      await expect(mangaTab).toHaveAccessibleDescription("Loading manga info…")
      await panel.emulateMedia({ reducedMotion: "reduce" })
      const cue = mangaTab.locator(".manga-tab-cue")
      await expect(cue).toBeVisible()
      expect(
        await cue.evaluate(
          (element) => getComputedStyle(element, "::before").animationName
        )
      ).toBe("none")
      await queueTab.press("ArrowRight")
      await expect(mangaTab).toBeFocused()
      await expect(progress).toBeVisible({ timeout: 3_000 })
      await expect(mangaView.getByRole("checkbox")).toHaveCount(0)

      resolve()
      await expect(
        mangaView.getByRole("heading", { name: seriesTitle })
      ).toBeVisible()
      await expect(mangaTab).toHaveAttribute("aria-selected", "true")
      await expect(mangaTab).not.toHaveAttribute("aria-describedby")
    } finally {
      resolve()
      await panel.close()
    }
  })

  test("front page -> episode page initializes tab state", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(SHONENJUMPPLUS_BASE_URL, { waitUntil: "domcontentloaded" })
    const tabId = await getTabId(page, context)

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()

    await page.bringToFront()

    const episodeUrl = `${SHONENJUMPPLUS_BASE_URL}/episode/${ShonenJumpPlus.BASIC_SERIES.series.seriesId}`
    await page.goto(episodeUrl, { waitUntil: "domcontentloaded" })

    await waitForTabSeriesTitle(
      context,
      tabId,
      ShonenJumpPlus.BASIC_SERIES.series.seriesTitle
    )

    await sp.getByRole("tab", { name: "Manga", exact: true }).click()
    const cover = sp.locator(".manga-cover img")
    await expect(cover).toHaveAttribute("src", /^blob:/)
    await expect
      .poll(() =>
        cover.evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0
        )
      )
      .toBe(true)

    await sp.getByRole("tab", { name: "Manga", exact: true }).click()
    if (await sp.getByRole("radio", { name: "Chapters", exact: true }).count())
      await sp.getByRole("radio", { name: "Chapters", exact: true }).click()
    const lockedChapter = sp.getByRole("checkbox", { name: /^140話$/ })
    await expect(lockedChapter).toBeDisabled()
    await expect(sp.getByText("Locked", { exact: true }).first()).toBeVisible()
    await expect(sp.getByRole("checkbox", { name: /^142話$/ })).toBeEnabled()

    await sp.close()
  })

  test("episode -> front page -> different episode reinitializes tab state", async ({
    context,
    extensionId,
    page,
  }) => {
    const episode1Url = `${SHONENJUMPPLUS_BASE_URL}/episode/${ShonenJumpPlus.BASIC_SERIES.series.seriesId}`
    const episode2Url = `${SHONENJUMPPLUS_BASE_URL}/episode/${ShonenJumpPlus.MINIMAL_SERIES.series.seriesId}`

    await page.goto(episode1Url, { waitUntil: "domcontentloaded" })
    const tabId = await getTabId(page, context)

    const sp = await openMangaSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()
    await page.bringToFront()

    await waitForTabSeriesTitle(
      context,
      tabId,
      ShonenJumpPlus.BASIC_SERIES.series.seriesTitle
    )

    await page.goto(SHONENJUMPPLUS_BASE_URL, { waitUntil: "domcontentloaded" })
    await waitForTabStateCleared(context, tabId)

    await page.goto(episode2Url, { waitUntil: "domcontentloaded" })
    await waitForTabSeriesTitle(
      context,
      tabId,
      ShonenJumpPlus.MINIMAL_SERIES.series.seriesTitle
    )

    await sp.close()
  })
})
