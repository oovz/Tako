import { test, expect } from "../../e2e/fixtures/extension"
import { LIVE_SHONENJUMPPLUS_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import {
  loadLiveTabState,
  assertNumericChapterProjection,
} from "../fixtures/metadata-extraction-helpers"

test.describe("Shonen Jump+ metadata extraction (live)", () => {
  test("extracts chapter numbers and preserves absent volume numbers from live Shonen Jump+ state", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.goto(LIVE_SHONENJUMPPLUS_REFERENCE_URL, {
      waitUntil: "domcontentloaded",
    })

    const state = await loadLiveTabState(
      context,
      extensionId,
      page,
      "shonenjumpplus"
    )
    expect(state.siteIntegrationId).toBe("shonenjumpplus")
    expect(Array.isArray(state.chapters)).toBe(true)

    assertNumericChapterProjection(state.chapters ?? [], {
      minNumberedChapters: 3,
      expectAnyVolumeNumbers: false,
    })

    const parsedChapters = (state.chapters ?? []).filter(
      (chapter) =>
        typeof chapter.chapterNumber === "number" && chapter.chapterNumber >= 0
    )
    expect(parsedChapters.length).toBeGreaterThan(0)

    const coverUrl = new URL(state.metadata?.coverUrl ?? "")
    expect(coverUrl.protocol).toBe("https:")
    expect([
      "cdn-ak-img.shonenjumpplus.com",
      "cdn-scissors.gigaviewer.com",
    ]).toContain(coverUrl.hostname)
    expect(
      (state.chapters ?? []).some((chapter) => chapter.locked === true)
    ).toBe(true)
    expect(
      (state.chapters ?? []).some((chapter) => chapter.locked !== true)
    ).toBe(true)

    await page.close()
  })
})
