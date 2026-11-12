import { test, expect } from "../../e2e/fixtures/extension"
import { LIVE_SHONENJUMPPLUS_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import {
  loadLiveTabState,
  assertNumericChapterProjection,
} from "../fixtures/metadata-extraction-helpers"

test.describe("Shonen Jump+ metadata extraction (live)", () => {
  test("keeps the displayed creator, synopsis, and episode date", async ({
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
    expect(state.metadata).toMatchObject({
      author: (
        await page.locator(".series-header-author").textContent()
      )?.trim(),
      description: (
        await page.locator(".series-header-description").textContent()
      )
        ?.replace(/\s+/g, " ")
        .trim(),
      publisher: "Shueisha",
      imprint: "少年ジャンプ＋",
    })
    const episodeId = new URL(page.url()).pathname.split("/").at(-1)
    const date = await page.locator(".episode-header-date").textContent()
    expect(date?.trim()).toMatch(/^\d{4}年\d{2}月\d{2}日$/)
    expect(
      state.chapters?.find((chapter) => chapter.id === episodeId)
    ).toMatchObject({
      releaseDate: date
        ?.trim()
        .replace(/[年月]/g, "-")
        .replace(/日$/, ""),
    })

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
