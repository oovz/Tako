import { test, expect } from "../../e2e/fixtures/extension"
import {
  LIVE_PIXIV_COMIC_REFERENCE_URL,
  LIVE_PIXIV_COMIC_DUPLICATE_TITLE_URL,
  LIVE_PIXIV_COMIC_DUAL_TITLE_URL,
} from "../../e2e/fixtures/test-domains-constants"
import {
  loadLiveTabState,
  assertNumericChapterProjection,
} from "../fixtures/metadata-extraction-helpers"

test.describe("Pixiv Comic metadata extraction (live)", () => {
  test("extracts chapter numbers without adding volume numbers", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.goto(LIVE_PIXIV_COMIC_REFERENCE_URL, {
      waitUntil: "domcontentloaded",
    })

    const state = await loadLiveTabState(
      context,
      extensionId,
      page,
      "pixiv-comic"
    )
    expect(state.siteIntegrationId).toBe("pixiv-comic")
    expect(Array.isArray(state.chapters)).toBe(true)

    assertNumericChapterProjection(state.chapters ?? [], {
      minNumberedChapters: 3,
      expectAnyVolumeNumbers: false,
    })

    await page.close()
  })

  test("keeps chapters with matching titles separate across arcs", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.goto(LIVE_PIXIV_COMIC_DUPLICATE_TITLE_URL, {
      waitUntil: "domcontentloaded",
    })

    const state = await loadLiveTabState(
      context,
      extensionId,
      page,
      "pixiv-comic"
    )
    const chapters = state.chapters ?? []

    const duplicateFirstChapters = chapters.filter(
      (chapter) => chapter.title === "第1話"
    )
    expect(duplicateFirstChapters.length).toBeGreaterThanOrEqual(2)
    expect(
      new Set(duplicateFirstChapters.map((chapter) => chapter.id)).size
    ).toBe(duplicateFirstChapters.length)
    expect(
      duplicateFirstChapters.every((chapter) => chapter.chapterNumber === 1)
    ).toBe(true)

    await page.close()
  })

  test("combines chapter numbers and subtitles and parses full-width numerals", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.goto(LIVE_PIXIV_COMIC_DUAL_TITLE_URL, {
      waitUntil: "domcontentloaded",
    })

    const state = await loadLiveTabState(
      context,
      extensionId,
      page,
      "pixiv-comic"
    )
    const chapters = state.chapters ?? []

    const firstChapter = chapters.find((chapter) => chapter.id === "68314")
    expect(firstChapter).toBeTruthy()
    expect(firstChapter?.chapterLabel).toBe("第１話")
    expect(firstChapter?.title).toBe("第１話 岡野部長は友達がいない(1)")
    expect(firstChapter?.chapterNumber).toBe(1)

    await page.close()
  })
})
