import { test, expect } from "./fixtures/extension"
import {
  getTabId,
  openSidepanelHarness,
  waitForTabSeriesTitle,
  waitForTabStateCleared,
} from "./fixtures/state-helpers"
import { MANGAMILLION_BASE_URL } from "./fixtures/test-domains-constants"
import { MangaMillion } from "./fixtures/mock-data"

test.describe("MangaMillion side panel navigation workflows (mocked)", () => {
  test("front page -> title page initializes tab state", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(MANGAMILLION_BASE_URL, { waitUntil: "domcontentloaded" })
    const tabId = await getTabId(page, context)

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()

    await page.bringToFront()
    await page.goto(
      `${MANGAMILLION_BASE_URL}/en/title/${MangaMillion.BASIC_SERIES.series.seriesId}`,
      {
        waitUntil: "domcontentloaded",
      }
    )

    await waitForTabSeriesTitle(
      context,
      tabId,
      MangaMillion.BASIC_SERIES.series.seriesTitle
    )

    await sp.getByRole("button", { name: /Select Chapters/i }).click()
    await expect(
      sp.getByRole("checkbox", { name: /Chapter 1:Romance Dawn/i })
    ).toBeEnabled()
    await expect(
      sp.getByRole("checkbox", { name: /Chapter 2:They Call Him/i })
    ).toBeEnabled()

    await sp.close()
  })

  test("title page -> front page clears tab state", async ({
    context,
    extensionId,
    page,
  }) => {
    const titleUrl = `${MANGAMILLION_BASE_URL}/en/title/${MangaMillion.BASIC_SERIES.series.seriesId}`
    await page.goto(titleUrl, { waitUntil: "domcontentloaded" })
    const tabId = await getTabId(page, context)

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()

    await waitForTabSeriesTitle(
      context,
      tabId,
      MangaMillion.BASIC_SERIES.series.seriesTitle
    )

    await page.bringToFront()
    await page.goto(MANGAMILLION_BASE_URL, { waitUntil: "domcontentloaded" })
    await waitForTabStateCleared(context, tabId)

    await sp.close()
  })
})
