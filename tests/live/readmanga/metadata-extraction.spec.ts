import { test, expect } from "../../e2e/fixtures/extension"
import { LIVE_MANHUAGUI_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import { loadLiveTabState } from "../fixtures/metadata-extraction-helpers"

test.describe("Manhuagui metadata extraction (live)", () => {
  test("preserves category headings, actual volume numbers, and community rating", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.goto(LIVE_MANHUAGUI_REFERENCE_URL, {
      waitUntil: "domcontentloaded",
    })

    const state = await loadLiveTabState(
      context,
      extensionId,
      page,
      "readmanga"
    )
    expect(state.siteIntegrationId).toBe("readmanga")
    expect(Array.isArray(state.chapters)).toBe(true)
    expect(Array.isArray(state.volumes)).toBe(true)

    const volumes = state.volumes ?? []
    const volumeTitles = volumes.map((volume) => volume.title ?? volume.label)
    expect(volumeTitles).toEqual(["单行本", "单话", "番外篇"])

    for (const title of ["单行本", "番外篇", "单话"]) {
      const volume = volumes.find(
        (candidate) => candidate.title === title || candidate.label === title
      )
      expect(volume?.id).toBeTruthy()
      const chaptersInVolume = (state.chapters ?? []).filter(
        (chapter) => chapter.volumeId === volume?.id
      )
      expect(chaptersInVolume.length).toBeGreaterThan(0)
      expect(
        chaptersInVolume.every((chapter) => chapter.volumeLabel === title)
      ).toBe(true)
      if (title === "单行本") {
        expect(chaptersInVolume[0]).toMatchObject({
          title: "第01卷",
          volumeNumber: 1,
        })
      } else {
        expect(
          chaptersInVolume.every(
            (chapter) => chapter.volumeNumber === undefined
          )
        ).toBe(true)
      }
    }

    const singleTalkVolume = volumes.find(
      (volume) => volume.title === "单话" || volume.label === "单话"
    )
    const firstSingleTalkChapter = (state.chapters ?? []).find(
      (chapter) => chapter.volumeId === singleTalkVolume?.id
    )
    expect(firstSingleTalkChapter).toMatchObject({
      title: "第01回",
      chapterLabel: "第01回",
      volumeLabel: "单话",
    })
    expect(firstSingleTalkChapter?.title).not.toContain("54p")
    expect(new URL(state.metadata?.coverUrl ?? "").hostname).toBe(
      "cf.mhgui.com"
    )
    const score = page.locator("#scoreRes .score-avg em")
    await expect(score).toHaveText(/^\d+\.\d$/)
    const displayedFivePointScore = Number(await score.innerText()) / 2
    expect(
      Math.abs((state.metadata?.communityRating ?? 0) - displayedFivePointScore)
    ).toBeLessThan(0.03)

    await page.close()
  })
})
