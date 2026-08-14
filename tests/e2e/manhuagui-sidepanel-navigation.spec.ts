import { test, expect } from "./fixtures/extension"
import {
  getSessionState,
  getTabId,
  openSidepanelHarness,
  waitForTabSeriesTitle,
  waitForTabStateCleared,
} from "./fixtures/state-helpers"
import { MANHUAGUI_BASE_URL } from "./fixtures/test-domains-constants"
import { Manhuagui } from "./fixtures/mock-data"

test.describe("Manhuagui side panel navigation workflows (mocked)", () => {
  test("front page -> series page initializes tab state", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(MANHUAGUI_BASE_URL, { waitUntil: "domcontentloaded" })
    const tabId = await getTabId(page, context)

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()

    await page.bringToFront()

    const seriesUrl = `${MANHUAGUI_BASE_URL}/comic/${Manhuagui.BASIC_SERIES.series.seriesId}/`
    await page.goto(seriesUrl, { waitUntil: "domcontentloaded" })

    await waitForTabSeriesTitle(
      context,
      tabId,
      Manhuagui.BASIC_SERIES.series.seriesTitle
    )

    const series = Manhuagui.BASIC_SERIES.series
    const state = await getSessionState<{
      metadata?: { coverUrl?: string }
    }>(context, `tab_${tabId}`)
    expect(state?.metadata?.coverUrl).toBe(series.coverUrl)

    const cover = sp.getByRole("img", { name: series.seriesTitle })
    await expect(cover).toHaveAttribute("src", series.coverUrl!)
    await expect
      .poll(() =>
        cover.evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0
        )
      )
      .toBe(true)

    await sp.close()
  })

  test("adult-gated series stays visible but exposes no hidden chapters without consent", async ({
    context,
    extensionId,
    page,
  }) => {
    const seriesUrl = `${MANHUAGUI_BASE_URL}/comic/${Manhuagui.ADULT_SERIES.series.seriesId}/`

    await page.goto(seriesUrl, { waitUntil: "domcontentloaded" })
    const tabId = await getTabId(page, context)

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()
    await page.bringToFront()

    await waitForTabSeriesTitle(
      context,
      tabId,
      Manhuagui.ADULT_SERIES.series.seriesTitle
    )

    // Consent is read-only. The extension must not decode hidden __VIEWSTATE
    // chapters or synthesize the site's adult-consent cookie.
    await expect
      .poll(async () => {
        const state = await getSessionState<{
          chapterListNotice?: string
        }>(context, `tab_${tabId}`)
        return state?.chapterListNotice
      })
      .toBe("adult-consent-required")
    const state = await getSessionState<{
      chapters?: Array<{ id?: string }>
      chapterListNotice?: string
    }>(context, `tab_${tabId}`)
    const chapterIds = (state?.chapters ?? [])
      .map((chapter) => chapter.id)
      .filter((id): id is string => typeof id === "string")
    expect(chapterIds).toEqual([])
    expect(state?.chapterListNotice).toBe("adult-consent-required")
    await expect(
      sp.getByText(
        "Accept Manhuagui’s adult-content prompt, then reload this page."
      )
    ).toBeVisible()

    await sp.close()
  })

  test("refreshes chapter state after the user accepts the adult gate and reloads the page", async ({
    context,
    extensionId,
    page,
  }) => {
    const seriesUrl = `${MANHUAGUI_BASE_URL}/comic/${Manhuagui.ADULT_SERIES.series.seriesId}/`
    const expectedChapter = Manhuagui.ADULT_CHAPTERS.chapters[0]!

    await page.goto(seriesUrl, { waitUntil: "domcontentloaded" })
    const tabId = await getTabId(page, context)
    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()
    await page.bringToFront()

    await waitForTabSeriesTitle(
      context,
      tabId,
      Manhuagui.ADULT_SERIES.series.seriesTitle
    )
    await expect(page.locator("#checkAdult")).toHaveCount(1)

    // The extension does not observe or handle the adult-gate acceptance
    // event. The user grants Manhuagui's own consent (here simulated by the
    // cookie) and refreshes the page; the extension then resolves the newly
    // ungated page like any other navigation.
    await context.addCookies([
      {
        name: "isAdult",
        value: "1",
        domain: "www.manhuagui.com",
        path: "/",
      },
    ])
    await page.reload({ waitUntil: "domcontentloaded" })

    await expect(page.locator(".chapter-list").first()).toBeVisible()
    await expect(page.locator("#checkAdult")).toHaveCount(0)
    await expect(
      sp.getByText(
        "Accept Manhuagui’s adult-content prompt, then reload this page."
      )
    ).toHaveCount(0)

    await expect
      .poll(async () => {
        const state = await getSessionState<{
          chapters?: Array<{ id?: string }>
        }>(context, `tab_${tabId}`)
        return state?.chapters?.some(
          (chapter) => chapter.id === expectedChapter.id
        )
      })
      .toBe(true)

    await sp.close()
  })

  test("category headings render as volume labels in the chapter selector", async ({
    context,
    extensionId,
    page,
  }) => {
    const seriesUrl = `${MANHUAGUI_BASE_URL}/comic/${Manhuagui.CATEGORY_SERIES.series.seriesId}/`

    await page.goto(seriesUrl, { waitUntil: "domcontentloaded" })
    const tabId = await getTabId(page, context)

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()
    await page.bringToFront()

    await waitForTabSeriesTitle(
      context,
      tabId,
      Manhuagui.CATEGORY_SERIES.series.seriesTitle
    )

    const state = await getSessionState<{
      volumes?: Array<{ id?: string; title?: string; label?: string }>
      chapters?: Array<{
        id?: string
        volumeId?: string
        volumeLabel?: string
        volumeNumber?: number
      }>
    }>(context, `tab_${tabId}`)
    expect(state?.volumes).toEqual([
      { id: "manhuagui-volume-1", title: "单行本", label: "单行本" },
      { id: "manhuagui-volume-2", title: "番外篇", label: "番外篇" },
      { id: "manhuagui-volume-3", title: "单话", label: "单话" },
    ])
    expect(
      state?.chapters?.map((chapter) => ({
        id: chapter.id,
        volumeId: chapter.volumeId,
        volumeLabel: chapter.volumeLabel,
        volumeNumber: chapter.volumeNumber,
      }))
    ).toEqual(
      expect.arrayContaining([
        {
          id: "378325",
          volumeId: "manhuagui-volume-1",
          volumeLabel: "单行本",
          volumeNumber: undefined,
        },
        {
          id: "363932",
          volumeId: "manhuagui-volume-2",
          volumeLabel: "番外篇",
          volumeNumber: undefined,
        },
        {
          id: "357842",
          volumeId: "manhuagui-volume-3",
          volumeLabel: "单话",
          volumeNumber: undefined,
        },
      ])
    )

    await sp.getByRole("button", { name: /Select Chapters/i }).click()
    const volumeRows = sp.locator(
      '[data-testid="inline-item"][data-kind="volume"]'
    )
    await expect(volumeRows).toHaveCount(3)
    await expect(volumeRows).toContainText(["单行本", "番外篇", "单话"])
    await expect(volumeRows).not.toContainText([
      "Volume 1",
      "Volume 2",
      "Volume 3",
    ])

    await sp.close()
  })

  test("series -> front page -> different series reinitializes tab state", async ({
    context,
    extensionId,
    page,
  }) => {
    const series1Url = `${MANHUAGUI_BASE_URL}/comic/${Manhuagui.BASIC_SERIES.series.seriesId}/`
    const series2Url = `${MANHUAGUI_BASE_URL}/comic/${Manhuagui.MINIMAL_SERIES.series.seriesId}/`

    await page.goto(series1Url, { waitUntil: "domcontentloaded" })
    const tabId = await getTabId(page, context)

    const sp = await openSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()
    await page.bringToFront()

    await waitForTabSeriesTitle(
      context,
      tabId,
      Manhuagui.BASIC_SERIES.series.seriesTitle
    )

    await page.goto(MANHUAGUI_BASE_URL, { waitUntil: "domcontentloaded" })
    await waitForTabStateCleared(context, tabId)

    await page.goto(series2Url, { waitUntil: "domcontentloaded" })
    await waitForTabSeriesTitle(
      context,
      tabId,
      Manhuagui.MINIMAL_SERIES.series.seriesTitle
    )

    await sp.close()
  })
})
