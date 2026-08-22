import { test, expect } from "../../e2e/fixtures/extension"
import { LIVE_COMICNETTAI_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import { loadLiveTabState } from "../fixtures/metadata-extraction-helpers"

test.describe("Comic Nettai metadata extraction (live)", () => {
  test("retains structurally closed live Comic Nettai chapters as locked", async ({
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
      "comicnettai"
    )
    const expiredChapter = (state.chapters ?? []).find(
      (chapter) => chapter.id === "829"
    )
    expect(expiredChapter).toMatchObject({
      title: "第40話",
      locked: true,
    })
    expect(expiredChapter?.url).toContain(
      "https://www.comicnettai.com/book/9#book-content-829"
    )
    await page.close()
  })
})
