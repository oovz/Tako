import { test, expect } from "../../e2e/fixtures/extension"
import { LIVE_MANGAPLUS_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import { loadLiveTabState } from "../fixtures/metadata-extraction-helpers"

test.use({ timezoneId: "UTC" })

test("keeps the displayed MANGA Plus age rating and chapter release date", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  try {
    await page.goto(LIVE_MANGAPLUS_REFERENCE_URL, {
      waitUntil: "domcontentloaded",
    })
    const state = await loadLiveTabState(
      context,
      extensionId,
      page,
      "mangaplus"
    )
    const rating = page.locator(
      '[class*="TitleDetailHeader-module_ratingText_"]'
    )
    await expect(rating).toHaveText("All Age")
    expect(state.metadata?.contentRating).toBe("all ages")

    const chapterDate = page
      .locator('[class*="ChapterListItem-module_chapterListItem_"]')
      .filter({ has: page.getByText("#001", { exact: true }) })
      .locator('[class*="ChapterListItem-module_date_"]')
    await expect(chapterDate).toHaveText("Mar 22, 2025")
    expect(
      state.chapters?.find((chapter) => chapter.id === "1024395")
    ).toMatchObject({
      chapterLabel: "001",
      releaseDate: "2025-03-22",
    })
  } finally {
    await page.close()
  }
})
