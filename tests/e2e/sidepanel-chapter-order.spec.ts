import { test, expect } from "./fixtures/extension"
import {
  seedTabContext,
  openMangaSidepanelHarness,
  setDownloadedChapterHistory,
  waitForActiveSeriesContextRevision,
  waitForGlobalState,
  waitForTabState,
} from "./fixtures/state-helpers"
import {
  buildMangadexUrl,
  MANGADEX_GROUPED_COLLAPSE_SERIES_ID,
  MANGADEX_ORDER_TEST_SERIES_ID,
  MANGADEX_STRESS_TOGGLE_SERIES_ID,
  MANGADEX_VIEW_TOGGLE_SERIES_ID,
} from "./fixtures/test-domains-constants"

const ORDER_TEST_SERIES_URL = buildMangadexUrl(
  `/title/${MANGADEX_ORDER_TEST_SERIES_ID}/ordering-test-series`
)
const VIEW_TOGGLE_SERIES_URL = buildMangadexUrl(
  `/title/${MANGADEX_VIEW_TOGGLE_SERIES_ID}/view-toggle-series`
)
const STRESS_TOGGLE_SERIES_URL = buildMangadexUrl(
  `/title/${MANGADEX_STRESS_TOGGLE_SERIES_ID}/stress-toggle-series`
)
const GROUPED_COLLAPSE_SERIES_URL = buildMangadexUrl(
  `/title/${MANGADEX_GROUPED_COLLAPSE_SERIES_ID}/grouped-collapse-series`
)

// Side Panel chapter list preserves mixed standalone/volume order

test.describe("Side Panel chapter/volume order", () => {
  test("renders standalone chapters and volumes in correct mixed order", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(ORDER_TEST_SERIES_URL, { waitUntil: "domcontentloaded" })

    const baseChapters = [
      {
        id: "standalone-1",
        url: "https://example.com/standalone-1",
        title: "Standalone chapter 1",
      },
      {
        id: "v2-c3",
        url: "https://example.com/v2-c3",
        title: "Volume 2 Chapter 3",
        chapterNumber: 3,
        volumeNumber: 2,
      },
      {
        id: "standalone-2",
        url: "https://example.com/standalone-2",
        title: "Standalone chapter 2",
      },
      {
        id: "v2-c4",
        url: "https://example.com/v2-c4",
        title: "Volume 2 Chapter 4",
        chapterNumber: 4,
        volumeNumber: 2,
      },
      {
        id: "v2-c5",
        url: "https://example.com/v2-c5",
        title: "Volume 2 Chapter 5",
        chapterNumber: 5,
        volumeNumber: 2,
      },
      {
        id: "standalone-3",
        url: "https://example.com/standalone-3",
        title: "Standalone chapter 3",
      },
      {
        id: "v2-c6",
        url: "https://example.com/v2-c6",
        title: "Volume 2 Chapter 6",
        chapterNumber: 6,
        volumeNumber: 2,
      },
    ]

    const tabId = await seedTabContext(
      page,
      context,
      {
        siteIntegrationId: "mangadex",
        mangaId: MANGADEX_ORDER_TEST_SERIES_ID,
        seriesTitle: "Ordering Test Series",
        chapters: baseChapters,
      },
      ORDER_TEST_SERIES_URL
    )

    await waitForTabState(page, context, (state) => {
      return (
        state.mangaId === MANGADEX_ORDER_TEST_SERIES_ID &&
        state.seriesTitle === "Ordering Test Series" &&
        state.chapters?.length === baseChapters.length
      )
    })

    const sp = await openMangaSidepanelHarness(context, extensionId, page)
    await waitForActiveSeriesContextRevision(context, tabId)
    await expect(sp.locator("#root")).toBeVisible()
    await expect(sp.getByText("Ordering Test Series")).toBeVisible({
      timeout: 15000,
    })

    const toggleButton = sp.getByRole("tab", { name: "Manga", exact: true })
    await expect(toggleButton).toBeVisible()
    await toggleButton.click()

    // Collect inline items in DOM order (volumes and standalones)
    const itemLocator = sp.locator('[data-testid="inline-item"]')
    // The selector adapts its virtualization window to the panel's animated
    // height. Wait for that window to settle rather than asserting a transient
    // subset mounted immediately after opening.
    await expect(itemLocator).toHaveCount(6)
    const count = await itemLocator.count()

    const items = [] as { kind: string | null; text: string }[]
    for (let i = 0; i < count; i++) {
      const el = itemLocator.nth(i)
      const kind = await el.getAttribute("data-kind")
      const text = (await el.innerText()).trim()
      items.push({ kind, text })
    }

    // We expect:
    // 0: standalone 1
    // 1: volume 2 (group 1)
    // 2: standalone 2
    // 3: volume 2 (group 2)
    // 4: standalone 3
    // 5: volume 2 (group 3)
    expect(items[0].kind).toBe("standalone")
    expect(items[0].text).toContain("Standalone chapter 1")

    expect(items[1].kind).toBe("volume")
    expect(items[1].text).toMatch(/Vol(?:ume|\.) 2/)

    expect(items[2].kind).toBe("standalone")
    expect(items[2].text).toContain("Standalone chapter 2")

    expect(items[3].kind).toBe("volume")
    expect(items[3].text).toMatch(/Vol(?:ume|\.) 2/)

    expect(items[4].kind).toBe("standalone")
    expect(items[4].text).toContain("Standalone chapter 3")

    expect(items[5].kind).toBe("volume")
    expect(items[5].text).toMatch(/Vol(?:ume|\.) 2/)

    await sp.close()
  })

  test("keeps hidden tab content inaccessible and honors reduced motion", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(ORDER_TEST_SERIES_URL, { waitUntil: "domcontentloaded" })
    const sp = await openMangaSidepanelHarness(context, extensionId, page)
    const manga = sp.getByRole("tabpanel", { name: "Manga" })
    await expect(manga).toBeVisible()
    await sp.getByRole("tab", { name: "Queue", exact: true }).click()
    await expect(manga).toBeHidden()
    await sp.emulateMedia({ reducedMotion: "reduce" })
    await sp.getByRole("tab", { name: "Manga", exact: true }).click()
    await expect(manga).toBeVisible()
    await expect
      .poll(() =>
        sp.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (animation) =>
                  Number(animation.effect?.getTiming().duration) > 1
              ).length
        )
      )
      .toBe(0)
    await sp.close()
  })

  test("reacts to persisted download completion with a chapter marker", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(ORDER_TEST_SERIES_URL, { waitUntil: "domcontentloaded" })
    await seedTabContext(
      page,
      context,
      {
        siteIntegrationId: "mangadex",
        mangaId: MANGADEX_ORDER_TEST_SERIES_ID,
        seriesTitle: "Downloaded Marker Series",
        chapters: [
          {
            id: "downloaded-chapter-1",
            url: "https://example.com/downloaded-chapter-1",
            title: "Downloaded Chapter 1",
          },
        ],
      },
      ORDER_TEST_SERIES_URL
    )
    await waitForTabState(
      page,
      context,
      (state) => state.seriesTitle === "Downloaded Marker Series"
    )

    const sp = await openMangaSidepanelHarness(context, extensionId, page)
    await expect(sp.getByText("Downloaded Marker Series")).toBeVisible({
      timeout: 15000,
    })
    await sp.getByRole("tab", { name: "Manga", exact: true }).click()
    await expect(sp.locator("[data-downloaded-marker]")).toHaveCount(0)

    await setDownloadedChapterHistory(context, [
      {
        siteIntegrationId: "mangadex",
        chapterId: "downloaded-chapter-1",
        url: "https://example.com/downloaded-chapter-1",
        title: "Downloaded Chapter 1",
        seriesId: MANGADEX_ORDER_TEST_SERIES_ID,
        seriesTitle: "Downloaded Marker Series",
        downloadedAt: Date.now(),
        format: "cbz",
      },
    ])

    await expect(sp.locator("[data-downloaded-marker]")).toBeVisible()
    await sp.close()
  })

  test("volume select-all operates per contiguous volume group", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(ORDER_TEST_SERIES_URL, { waitUntil: "domcontentloaded" })

    const baseChapters = [
      {
        id: "standalone-1",
        url: "https://example.com/standalone-1",
        title: "Standalone chapter 1",
      },
      {
        id: "v2-c3",
        url: "https://example.com/v2-c3",
        title: "Volume 2 Chapter 3",
        chapterNumber: 3,
        volumeNumber: 2,
      },
      {
        id: "standalone-2",
        url: "https://example.com/standalone-2",
        title: "Standalone chapter 2",
      },
      {
        id: "v2-c4",
        url: "https://example.com/v2-c4",
        title: "Volume 2 Chapter 4",
        chapterNumber: 4,
        volumeNumber: 2,
      },
      {
        id: "v2-c5",
        url: "https://example.com/v2-c5",
        title: "Volume 2 Chapter 5",
        chapterNumber: 5,
        volumeNumber: 2,
      },
      {
        id: "standalone-3",
        url: "https://example.com/standalone-3",
        title: "Standalone chapter 3",
      },
      {
        id: "v2-c6",
        url: "https://example.com/v2-c6",
        title: "Volume 2 Chapter 6",
        chapterNumber: 6,
        volumeNumber: 2,
      },
    ]

    await seedTabContext(
      page,
      context,
      {
        siteIntegrationId: "mangadex",
        mangaId: MANGADEX_ORDER_TEST_SERIES_ID,
        seriesTitle: "Ordering Test Series",
        chapters: baseChapters,
      },
      ORDER_TEST_SERIES_URL
    )

    await waitForTabState(page, context, (state) => {
      return (
        state.mangaId === MANGADEX_ORDER_TEST_SERIES_ID &&
        state.seriesTitle === "Ordering Test Series" &&
        state.chapters?.length === baseChapters.length
      )
    })

    const sp = await openMangaSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()
    await expect(sp.getByText("Ordering Test Series")).toBeVisible({
      timeout: 15000,
    })

    const toggleButton = sp.getByRole("tab", { name: "Manga", exact: true })
    await expect(toggleButton).toBeVisible()
    await toggleButton.click()

    // Click "Select All" on the second Volume 2 group (with chapters v2-c4 and v2-c5)
    const volumeItems = sp.locator(
      '[data-testid="inline-item"][data-kind="volume"]'
    )
    await expect(volumeItems).toHaveCount(3)
    for (const disclosure of await volumeItems.getByRole("button").all())
      await disclosure.click()
    const secondVolume = volumeItems.nth(1)
    const secondVolumeSelectAll = secondVolume.getByRole("checkbox")
    await secondVolumeSelectAll.click()

    await expect(
      sp.getByRole("button", { name: /Download \(2\)/i })
    ).toBeVisible()
    await expect(
      sp.getByRole("checkbox", { name: /Volume 2 Chapter 4/i })
    ).toBeChecked()
    await expect(
      sp.getByRole("checkbox", { name: /Volume 2 Chapter 5/i })
    ).toBeChecked()
    await expect(
      sp.getByRole("checkbox", { name: /Volume 2 Chapter 3/i })
    ).not.toBeChecked()
    await expect(
      sp.getByRole("checkbox", { name: /Volume 2 Chapter 6/i })
    ).not.toBeChecked()
    await expect(
      sp.getByRole("checkbox", { name: /Standalone chapter 1/i })
    ).not.toBeChecked()
    await expect(
      sp.getByRole("checkbox", { name: /Standalone chapter 2/i })
    ).not.toBeChecked()
    await expect(
      sp.getByRole("checkbox", { name: /Standalone chapter 3/i })
    ).not.toBeChecked()

    await sp.close()
  })

  test("keyboard volume select-all does not collapse the volume group", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(ORDER_TEST_SERIES_URL, { waitUntil: "domcontentloaded" })

    const baseChapters = [
      {
        id: "standalone-1",
        url: "https://example.com/standalone-1",
        title: "Standalone chapter 1",
      },
      {
        id: "v2-c3",
        url: "https://example.com/v2-c3",
        title: "Volume 2 Chapter 3",
        chapterNumber: 3,
        volumeNumber: 2,
      },
      {
        id: "standalone-2",
        url: "https://example.com/standalone-2",
        title: "Standalone chapter 2",
      },
      {
        id: "v2-c4",
        url: "https://example.com/v2-c4",
        title: "Volume 2 Chapter 4",
        chapterNumber: 4,
        volumeNumber: 2,
      },
      {
        id: "v2-c5",
        url: "https://example.com/v2-c5",
        title: "Volume 2 Chapter 5",
        chapterNumber: 5,
        volumeNumber: 2,
      },
      {
        id: "standalone-3",
        url: "https://example.com/standalone-3",
        title: "Standalone chapter 3",
      },
      {
        id: "v2-c6",
        url: "https://example.com/v2-c6",
        title: "Volume 2 Chapter 6",
        chapterNumber: 6,
        volumeNumber: 2,
      },
    ]

    await seedTabContext(
      page,
      context,
      {
        siteIntegrationId: "mangadex",
        mangaId: MANGADEX_ORDER_TEST_SERIES_ID,
        seriesTitle: "Ordering Test Series",
        chapters: baseChapters,
      },
      ORDER_TEST_SERIES_URL
    )

    await waitForTabState(page, context, (state) => {
      return (
        state.mangaId === MANGADEX_ORDER_TEST_SERIES_ID &&
        state.seriesTitle === "Ordering Test Series" &&
        state.chapters?.length === baseChapters.length
      )
    })

    const sp = await openMangaSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()
    await expect(sp.getByText("Ordering Test Series")).toBeVisible({
      timeout: 15000,
    })

    await sp.getByRole("tab", { name: "Manga", exact: true }).click()

    const secondVolume = sp
      .locator('[data-testid="inline-item"][data-kind="volume"]')
      .nth(1)
    const secondVolumeDisclosure = secondVolume.getByRole("button")
    await secondVolumeDisclosure.click()
    await expect(secondVolumeDisclosure).toHaveAttribute(
      "aria-expanded",
      "true"
    )

    await secondVolume.getByRole("checkbox").focus()
    await sp.keyboard.press("Space")

    await expect(
      sp.getByRole("button", { name: /Download \(2\)/i })
    ).toBeVisible()
    await expect(secondVolumeDisclosure).toHaveAttribute(
      "aria-expanded",
      "true"
    )
    await expect(
      sp.getByRole("checkbox", { name: /Volume 2 Chapter 4/i })
    ).toBeVisible()
    await expect(
      sp.getByRole("checkbox", { name: /Volume 2 Chapter 5/i })
    ).toBeVisible()

    await sp.close()
  })

  test("switches between volume groups and individual chapters", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(VIEW_TOGGLE_SERIES_URL, { waitUntil: "domcontentloaded" })

    const baseChapters = Array.from({ length: 32 }, (_, index) => {
      const chapterNumber = index + 1
      const volumeNumber = chapterNumber <= 16 ? 1 : 2

      return {
        id: `toggle-${chapterNumber}`,
        url: `https://example.com/toggle-${chapterNumber}`,
        title: `Volume ${volumeNumber} Chapter ${chapterNumber}`,
        chapterNumber,
        volumeNumber,
      }
    })

    await seedTabContext(
      page,
      context,
      {
        siteIntegrationId: "mangadex",
        mangaId: MANGADEX_VIEW_TOGGLE_SERIES_ID,
        seriesTitle: "View Toggle Series",
        chapters: baseChapters,
      },
      VIEW_TOGGLE_SERIES_URL
    )

    await waitForTabState(page, context, (state) => {
      return (
        state.mangaId === MANGADEX_VIEW_TOGGLE_SERIES_ID &&
        state.seriesTitle === "View Toggle Series" &&
        state.chapters?.length === baseChapters.length
      )
    })

    const sp = await openMangaSidepanelHarness(context, extensionId, page)
    await expect(sp.locator("#root")).toBeVisible()
    await expect(sp.getByText("View Toggle Series")).toBeVisible({
      timeout: 15000,
    })

    await sp.getByRole("tab", { name: "Manga", exact: true }).click()
    const viewModeTrigger = sp.getByRole("radio", { name: /Chapters/i })

    await expect(sp.getByText(/^Vol(?:ume|\.) 1$/)).toBeVisible()
    await expect(viewModeTrigger).toBeVisible()
    await expect(viewModeTrigger).toHaveText("Chapters")

    const firstVolumeRow = sp
      .locator('[data-testid="inline-item"][data-kind="volume"]')
      .first()
    await expect(firstVolumeRow).not.toContainText("selectable")

    await viewModeTrigger.click()

    await expect(sp.getByText("View Toggle Series")).toBeVisible()
    const groupByVolumeButton = sp.getByRole("radio", { name: /^Volumes$/i })
    await expect(groupByVolumeButton).toBeVisible()
    await expect(groupByVolumeButton).toHaveText("Volumes")
    await expect(sp.locator("#toggle-1")).toBeVisible()
    await expect(sp.locator("#toggle-2")).toBeVisible()

    await groupByVolumeButton.click()

    await expect(sp.getByRole("radio", { name: /Chapters/i })).toBeVisible()
    await expect(sp.getByText(/^Vol(?:ume|\.) 1$/)).toBeVisible()

    await sp.close()
  })

  test("keeps a virtualized selector usable through repeated view changes", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(STRESS_TOGGLE_SERIES_URL, {
      waitUntil: "domcontentloaded",
    })

    const baseChapters = Array.from({ length: 72 }, (_, index) => {
      const chapterNumber = index + 1
      const volumeNumber = chapterNumber <= 36 ? 1 : 2

      return {
        id: `stress-${chapterNumber}`,
        url: `https://example.com/stress-${chapterNumber}`,
        title: `Volume ${volumeNumber} Chapter ${chapterNumber}`,
        chapterNumber,
        volumeNumber,
      }
    })

    await seedTabContext(
      page,
      context,
      {
        siteIntegrationId: "mangadex",
        mangaId: MANGADEX_STRESS_TOGGLE_SERIES_ID,
        seriesTitle: "Stress Toggle Series",
        chapters: baseChapters,
      },
      STRESS_TOGGLE_SERIES_URL
    )

    await waitForTabState(page, context, (state) => {
      return (
        state.mangaId === MANGADEX_STRESS_TOGGLE_SERIES_ID &&
        state.seriesTitle === "Stress Toggle Series" &&
        state.chapters?.length === baseChapters.length
      )
    })

    const sp = await openMangaSidepanelHarness(context, extensionId, page)
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    sp.on("pageerror", () => {
      pageErrors.push("Uncaught sidepanel error")
    })
    sp.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push("Sidepanel console error")
      }
    })

    await expect(sp.locator("#root")).toBeVisible()
    await expect(sp.getByText("Stress Toggle Series")).toBeVisible({
      timeout: 15000,
    })

    await sp.getByRole("tab", { name: "Manga", exact: true }).click()

    await sp.locator(".manga-volume-toggle").first().click()
    const firstChapter = sp.getByRole("checkbox", {
      name: baseChapters[0].title,
      exact: true,
    })
    await expect(firstChapter).toBeVisible()
    await firstChapter.click()
    await expect(firstChapter).toBeChecked()
    await expect(
      sp.getByRole("button", { name: /Download \(1\)/i })
    ).toBeVisible()

    for (let iteration = 0; iteration < 10; iteration += 1) {
      const isGroupedView = iteration % 2 === 0
      await sp
        .getByRole("radio", {
          name: isGroupedView ? /Chapters/i : /^Volumes$/i,
        })
        .click()
    }

    await expect(firstChapter).toBeVisible()
    await expect(firstChapter).toBeChecked()
    await firstChapter.click()
    await expect(firstChapter).not.toBeChecked()
    await firstChapter.click()
    await expect(firstChapter).toBeChecked()
    await expect(
      sp.getByRole("button", { name: /Download \(1\)/i })
    ).toBeVisible()

    await expect(sp.locator("#root")).toBeVisible()
    await expect(sp.getByRole("radio", { name: /Chapters/i })).toBeVisible()
    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])

    await sp.close()
  })

  test("closes the grouped selector and restores focus after starting a download", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.goto(GROUPED_COLLAPSE_SERIES_URL, {
      waitUntil: "domcontentloaded",
    })

    const baseChapters = [
      {
        id: "v1-c1",
        url: "https://example.com/collapse-v1-c1",
        title: "Volume 1 Chapter 1",
        chapterNumber: 1,
        volumeNumber: 1,
      },
      {
        id: "v1-c2",
        url: "https://example.com/collapse-v1-c2",
        title: "Volume 1 Chapter 2",
        chapterNumber: 2,
        volumeNumber: 1,
      },
      {
        id: "v2-c3",
        url: "https://example.com/collapse-v2-c3",
        title: "Volume 2 Chapter 3",
        chapterNumber: 3,
        volumeNumber: 2,
      },
    ]

    const groupedTabId = await seedTabContext(
      page,
      context,
      {
        siteIntegrationId: "mangadex",
        mangaId: MANGADEX_GROUPED_COLLAPSE_SERIES_ID,
        seriesTitle: "Grouped Collapse Series",
        chapters: baseChapters,
      },
      GROUPED_COLLAPSE_SERIES_URL
    )

    await waitForTabState(page, context, (state) => {
      return (
        state.mangaId === MANGADEX_GROUPED_COLLAPSE_SERIES_ID &&
        state.seriesTitle === "Grouped Collapse Series" &&
        state.chapters?.length === baseChapters.length
      )
    })

    const sp = await openMangaSidepanelHarness(context, extensionId, page)
    await waitForActiveSeriesContextRevision(context, groupedTabId)
    await expect(sp.locator("#root")).toBeVisible()
    await expect(sp.getByText("Grouped Collapse Series")).toBeVisible({
      timeout: 15000,
    })

    await sp.getByRole("tab", { name: "Manga", exact: true }).click()
    const viewModeTrigger = sp.getByRole("radio", { name: /Chapters/i })
    await expect(viewModeTrigger).toBeVisible()
    await viewModeTrigger.click()

    await sp.getByText("Volume 1 Chapter 1").click()
    await expect(
      sp.getByRole("button", { name: /Download \(1\)/i })
    ).toBeVisible()

    await sp.getByRole("button", { name: /Download \(1\)/i }).click()

    await waitForGlobalState(
      context,
      (state) =>
        Array.isArray(state.downloadQueue) && state.downloadQueue.length >= 1
    )

    const reopenedSelectorButton = sp.getByRole("tab", {
      name: "Manga",
      exact: true,
    })
    await expect(reopenedSelectorButton).toBeVisible()
    await expect(
      sp.getByRole("tab", { name: "Queue", exact: true })
    ).toBeFocused()
    await expect(
      sp.getByRole("tab", { name: "Queue", exact: true })
    ).toHaveAttribute("aria-selected", "true")
    await expect(sp.getByRole("radio", { name: /^Volumes$/i })).toBeHidden()

    await sp.close()
  })
})

test("keeps long titles and chapter statuses readable in a resizable panel", async ({
  context,
  extensionId,
  page,
}) => {
  const seriesTitle =
    "The Apothecary's Atlas of Forgotten Cities and the Secrets Hidden Under the Northern Sea"
  const chapters = Array.from({ length: 65 }, (_, index) => ({
    id: `long-title-${index + 1}`,
    url: `https://example.com/long-title-${index + 1}`,
    title: `Chapter ${index + 1}: A Letter from the Cartographer Who Never Returned from the Northern Sea`,
    locked: index === 0,
  }))
  await page.goto(STRESS_TOGGLE_SERIES_URL)
  await seedTabContext(
    page,
    context,
    {
      siteIntegrationId: "mangadex",
      mangaId: MANGADEX_STRESS_TOGGLE_SERIES_ID,
      seriesTitle,
      metadata: { author: "Aya Mori" },
      chapters,
    },
    STRESS_TOGGLE_SERIES_URL
  )

  const panel = await openMangaSidepanelHarness(context, extensionId, page)
  await panel.setViewportSize({ width: 360, height: 730 })
  await panel.getByRole("tab", { name: "Manga", exact: true }).click()

  const downloadedAt = Date.now()
  await setDownloadedChapterHistory(
    context,
    chapters.slice(0, 3).map((chapter, index) => ({
      siteIntegrationId: "mangadex",
      seriesId: MANGADEX_STRESS_TOGGLE_SERIES_ID,
      seriesTitle,
      chapterId: chapter.id,
      title: chapter.title,
      url: chapter.url,
      downloadedAt,
      format: "cbz",
      ...(index < 2
        ? {
            saveConfirmedAt: downloadedAt,
            outputDestination: index === 0 ? "downloads-api" : "fsa",
          }
        : {}),
    }))
  )

  const list = panel.locator('[data-virtualized="true"]')
  const title = panel.getByRole("heading", { name: seriesTitle })
  const first = list.getByText(chapters[0].title, { exact: true })
  const firstRow = list.getByTestId("inline-item").filter({
    hasText: chapters[0].title,
  })
  const secondRow = list.getByTestId("inline-item").filter({
    hasText: chapters[1].title,
  })
  const locked = list.getByRole("checkbox", {
    name: chapters[0].title,
    exact: true,
  })
  const savedToFolder = list.getByRole("checkbox", {
    name: chapters[1].title,
    exact: true,
  })
  const processed = list.getByRole("checkbox", {
    name: chapters[2].title,
    exact: true,
  })
  const cover = panel.locator(".manga-cover")
  const selectAll = panel.getByRole("checkbox", { name: "Select all" })
  await expect(first).toBeVisible()
  await expect(locked).toBeDisabled()
  await expect(locked).toHaveAccessibleDescription("Locked Saved")
  await expect(savedToFolder).toHaveAccessibleDescription("Saved to folder")
  await expect(processed).toHaveAccessibleDescription("Previously processed")

  for (const [width, height] of [
    [360, 730],
    [320, 620],
    [200, 640],
  ]) {
    await panel.setViewportSize({ width, height })
    await expect(
      panel.getByRole("tab", { name: "Queue", exact: true })
    ).toBeInViewport()
    await expect(cover).toBeInViewport({ ratio: 1 })
    await expect(selectAll).toBeInViewport({ ratio: 1 })
    await expect(selectAll.locator(".check-visual")).toBeVisible()
    for (const badge of [
      firstRow.getByTitle("Locked", { exact: true }),
      firstRow.getByTitle("Saved", { exact: true }),
      secondRow.getByTitle("Saved to folder", { exact: true }),
      list.getByTitle("Previously processed", { exact: true }),
    ]) {
      if (width > 240) await expect(badge).toBeInViewport({ ratio: 1 })
      else {
        const bounds = await badge.boundingBox()
        expect(bounds).not.toBeNull()
        expect(bounds!.x).toBeGreaterThanOrEqual(0)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      }
    }
    for (const label of [title, first]) {
      expect(
        await label.evaluate(
          (element) => element.scrollWidth <= element.clientWidth
        )
      ).toBe(true)
    }
    await expect
      .poll(async () => {
        const firstBox = await firstRow.boundingBox()
        const secondBox = await secondRow.boundingBox()
        return (
          !!firstBox &&
          !!secondBox &&
          firstBox.y + firstBox.height <= secondBox.y
        )
      })
      .toBe(true)
      .catch(async (error) => {
        console.log("ROW_GEOMETRY", {
          width,
          first: await firstRow.boundingBox(),
          second: await secondRow.boundingBox(),
        })
        throw error
      })
  }

  await savedToFolder.press("Space")
  await expect(selectAll).toHaveAttribute("aria-checked", "mixed")
  await selectAll.press("Space")
  await expect(selectAll).toBeChecked()
  await expect(locked).not.toBeChecked()
  await expect(
    panel.getByRole("button", { name: "Download (64)", exact: true })
  ).toBeVisible()
  await selectAll.press("Space")
  await expect(
    panel.getByRole("button", { name: "Download", exact: true })
  ).toBeDisabled()

  await expect(first).toHaveAttribute("title", chapters[0].title)
  await panel.getByRole("button", { name: "More details", exact: true }).click()
  await expect(panel.getByText("Aya Mori", { exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "Less detail", exact: true }).click()
  const last = list.getByRole("checkbox", {
    name: chapters[64].title,
    exact: true,
  })
  // New rows change the estimated height as they enter the virtual window.
  await expect
    .poll(async () => {
      await panel.locator(".manga-scroll").evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      return last.count()
    })
    .toBe(1)
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeInViewport()
  await last.press("Space")
  await expect(last).toBeChecked()
})
