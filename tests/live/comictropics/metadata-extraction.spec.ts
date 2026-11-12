import { test, expect } from "../../e2e/fixtures/extension"
import { LIVE_COMICNETTAI_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import { loadLiveTabState } from "../fixtures/metadata-extraction-helpers"

test.describe("Comic Nettai metadata extraction (live)", () => {
  test("keeps release dates for unavailable chapters", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.goto(LIVE_COMICNETTAI_REFERENCE_URL, {
      waitUntil: "domcontentloaded",
    })

    const state = await loadLiveTabState(
      context,
      extensionId,
      page,
      "comictropics"
    )
    const expiredChapter = (state.chapters ?? []).find(
      (chapter) => chapter.id === "829"
    )
    const releaseDate = await page
      .locator(".detail--product__item")
      .filter({ hasText: "第40話" })
      .locator(".detail--product__item__sdate")
      .textContent()
    expect(releaseDate?.trim()).toMatch(/^\d{4}\.\d{2}\.\d{2}$/)
    expect(expiredChapter).toMatchObject({
      title: "第40話",
      locked: true,
      releaseDate: releaseDate?.trim().replaceAll(".", "-"),
    })
    expect(state.metadata).toMatchObject({
      publisher: "Kobunsha",
      imprint: "COMIC熱帯",
    })
    expect(expiredChapter?.url).toContain(
      "https://www.comicnettai.com/book/9#book-content-829"
    )
    await page.close()
  })
})
