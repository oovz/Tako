import { test, expect } from "../../e2e/fixtures/extension"
import { LIVE_MANGAMILLION_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import { loadLiveTabState } from "../fixtures/metadata-extraction-helpers"

test.describe("MangaMillion metadata extraction (live)", () => {
  test("extracts live MangaMillion One Piece chapter metadata and numbers", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.goto(LIVE_MANGAMILLION_REFERENCE_URL, {
      waitUntil: "domcontentloaded",
    })

    const state = await loadLiveTabState(
      context,
      extensionId,
      page,
      "mangamillion"
    )
    expect(state.siteIntegrationId).toBe("mangamillion")
    expect(state.mangaId).toBe("1")
    expect(state.seriesTitle).toBe("One Piece")
    expect(Array.isArray(state.chapters)).toBe(true)
    expect(state.chapters?.length).toBeGreaterThan(0)

    const firstChapter = (state.chapters ?? []).find(
      (chapter) => chapter.id === "6736"
    )
    expect(firstChapter).toMatchObject({
      title: "Chapter 1:Romance Dawn",
      chapterLabel: "#001",
      chapterNumber: 1,
      locked: false,
    })

    await page.close()
  })
})
