import { test, expect } from "../../e2e/fixtures/extension"
import { LIVE_MANGAMILLION_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import { loadLiveTabState } from "../fixtures/metadata-extraction-helpers"

test.describe("MangaMillion metadata extraction (live)", () => {
  test("extracts One Piece author and chapter metadata", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    try {
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
      expect(state.metadata).toMatchObject({
        author: "Eiichiro Oda",
        language: "en",
      })

      const firstChapter = (state.chapters ?? []).find(
        (chapter) => chapter.id === "6736"
      )
      expect(firstChapter).toMatchObject({
        title: "Chapter 1:Romance Dawn",
        chapterLabel: "#001",
        chapterNumber: 1,
        locked: false,
      })
    } finally {
      await page.close()
    }
  })

  test("keeps free and locked Dandadan chapters distinct", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    try {
      await page.goto("https://mangamillion.shueisha.co.jp/en/title/10", {
        waitUntil: "domcontentloaded",
      })

      const state = await loadLiveTabState(
        context,
        extensionId,
        page,
        "mangamillion"
      )
      expect(state.mangaId).toBe("10")
      expect(state.seriesTitle).toBe("Dandadan")
      expect(state.metadata).toMatchObject({
        author: "Yukinobu Tatsu",
        language: "en",
      })

      const chapters = state.chapters ?? []
      expect(chapters.length).toBeGreaterThanOrEqual(30)
      expect(chapters.some((chapter) => chapter.locked === false)).toBe(true)
      expect(chapters.some((chapter) => chapter.locked === true)).toBe(true)
      expect(new Set(chapters.map((chapter) => chapter.id)).size).toBe(
        chapters.length
      )
    } finally {
      await page.close()
    }
  })

  test("extracts Simplified Chinese title and chapter metadata", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    try {
      await page.goto("https://mangamillion.shueisha.co.jp/zh-CN/title/10", {
        waitUntil: "domcontentloaded",
      })

      const state = await loadLiveTabState(
        context,
        extensionId,
        page,
        "mangamillion"
      )
      expect(state.mangaId).toBe("10")
      expect(state.seriesTitle?.trim().length).toBeGreaterThan(0)
      expect(state.metadata?.author?.trim().length).toBeGreaterThan(0)
      expect(state.metadata?.language).toBe("zh-CN")

      const chapters = state.chapters ?? []
      expect(chapters.length).toBeGreaterThan(0)
      expect(chapters.every((chapter) => chapter.language === "zh-CN")).toBe(
        true
      )
    } finally {
      await page.close()
    }
  })
})
