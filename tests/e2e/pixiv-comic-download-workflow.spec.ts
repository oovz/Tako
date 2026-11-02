import { test, expect } from "./fixtures/extension"
import {
  getTabId,
  waitForTabSeriesTitle,
  waitForTabStateById,
} from "./fixtures/state-helpers"
import { PIXIV_COMIC_BASE_URL } from "./fixtures/test-domains-constants"
import { PixivComic } from "./fixtures/mock-data"
import {
  assertTaskSucceeded,
  openOptionsPage,
  persistCustomModeDownloadSettings,
  seedCustomDirectoryHandle,
  startSingleChapterDownload,
  waitForCbzArtifact,
  waitForTerminalTask,
} from "./fixtures/download-workflow-helpers"
import {
  retainExtensionSessionRules,
  setIntegrationEnabledFromWorker,
  testExtensionSessionRuleMatch,
} from "./fixtures/session-rule-helpers"

test.describe("Pixiv Comic downloads", () => {
  test.describe.configure({ timeout: 120_000 })

  test("matches the pximg referer rule only for enabled extension-originated requests", async ({
    context,
    extensionId,
  }) => {
    // Deterministic external-network redirect/block rules have higher action
    // priority than modifyHeaders rules. Retain only production provider rules
    // so testMatchOutcome reports the referer rule itself.
    await retainExtensionSessionRules(context, extensionId, [41001, 41002])

    const extensionRequest = {
      initiator: `chrome-extension://${extensionId}/`,
      type: "xmlhttprequest",
      url: "https://img-comic.pximg.net/mock/story/page.png",
    } as const

    await expect
      .poll(
        () =>
          testExtensionSessionRuleMatch(context, extensionId, extensionRequest),
        { timeout: 10_000 }
      )
      .toContain(41001)
    await expect(
      testExtensionSessionRuleMatch(context, extensionId, {
        ...extensionRequest,
        initiator: "https://comic.pixiv.net/",
      })
    ).resolves.not.toContain(41001)

    await setIntegrationEnabledFromWorker(
      context,
      extensionId,
      "pixiv-comic",
      false
    )
    await expect
      .poll(
        () =>
          testExtensionSessionRuleMatch(context, extensionId, extensionRequest),
        { timeout: 10_000 }
      )
      .not.toContain(41001)
  })

  test("saves a complete chapter from the reader API", async ({
    context,
    extensionId,
    page,
  }) => {
    const series = PixivComic.BASIC_SERIES.series
    const seriesUrl = `${PIXIV_COMIC_BASE_URL}/works/${series.seriesId}`

    await page.goto(seriesUrl, { waitUntil: "domcontentloaded" })
    const tabId = await getTabId(page, context)

    await waitForTabSeriesTitle(context, tabId, series.seriesTitle)
    const tabState = await waitForTabStateById(
      page,
      context,
      tabId,
      (state) => Array.isArray(state.chapters) && state.chapters.length > 0
    )

    const firstChapter = tabState.chapters.find(
      (chapter) => chapter.id === PixivComic.PIXIV_COMIC_CAPTURED_STORY_ID
    )
    if (!firstChapter) {
      throw new Error(
        `No downloadable chapter found for series ${series.seriesId}`
      )
    }

    const optionsPage = await openOptionsPage(context, extensionId)
    try {
      const seededDirectoryName = await seedCustomDirectoryHandle(optionsPage)
      await persistCustomModeDownloadSettings(optionsPage)

      const taskId = await startSingleChapterDownload(optionsPage, {
        sourceTabId: tabId,
        siteIntegrationId: "pixiv-comic",
        mangaId: series.seriesId,
        seriesTitle: series.seriesTitle,
        chapter: {
          id: firstChapter.id,
          title: firstChapter.title,
          url: firstChapter.url,
          index: firstChapter.index,
          chapterLabel: firstChapter.chapterLabel,
          chapterNumber: firstChapter.chapterNumber,
          volumeLabel: firstChapter.volumeLabel,
          volumeNumber: firstChapter.volumeNumber,
          language: firstChapter.language,
        },
      })

      const task = await waitForTerminalTask(context, taskId)
      assertTaskSucceeded(task)
      expect(task.lastSuccessfulDownloadId).toBeUndefined()

      const files = await waitForCbzArtifact(optionsPage, seededDirectoryName)
      expect(
        files.some(
          (file) => file.path.toLowerCase().endsWith(".cbz") && file.size > 0
        )
      ).toBe(true)
    } finally {
      await optionsPage.close()
    }
  })
})
