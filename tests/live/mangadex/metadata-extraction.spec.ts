import { test, expect } from "../../e2e/fixtures/extension"
import { LIVE_MANGADEX_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import {
  loadLiveTabState,
  assertNumericChapterProjection,
} from "../fixtures/metadata-extraction-helpers"

test.describe("MangaDex metadata extraction (live)", () => {
  test("extracts chapter and volume numbers", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.goto(LIVE_MANGADEX_REFERENCE_URL, {
      waitUntil: "domcontentloaded",
    })

    const state = await loadLiveTabState(context, extensionId, page, "mangadex")
    expect(state.siteIntegrationId).toBe("mangadex")
    expect(Array.isArray(state.chapters)).toBe(true)

    assertNumericChapterProjection(state.chapters ?? [], {
      minNumberedChapters: 5,
      expectAnyVolumeNumbers: "if-present",
    })

    await page.close()
  })
})
