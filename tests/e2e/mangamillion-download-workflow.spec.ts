import { test, expect } from "./fixtures/extension"
import {
  getTabId,
  waitForTabSeriesTitle,
  waitForTabStateById,
} from "./fixtures/state-helpers"
import { MANGAMILLION_BASE_URL } from "./fixtures/test-domains-constants"
import { MangaMillion } from "./fixtures/mock-data"
import {
  assertTaskSucceeded,
  openOptionsPage,
  persistBrowserModeDownloadSettings,
  persistCustomModeDownloadSettings,
  seedCustomDirectoryHandle,
  startSingleChapterDownload,
  waitForBrowserDownloadArtifact,
  waitForCbzArtifact,
  waitForTerminalTask,
} from "./fixtures/download-workflow-helpers"

test.describe("MangaMillion download workflow (mocked)", () => {
  test.describe.configure({ timeout: 120_000 })

  test("completes a single-chapter download through the Protobuf and AES-256-CBC decryption pipeline", async ({
    context,
    extensionId,
    page,
  }) => {
    const series = MangaMillion.BASIC_SERIES.series
    const seriesUrl = `${MANGAMILLION_BASE_URL}/en/title/${series.seriesId}`

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
      (chapter) => chapter.locked !== true
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
        siteIntegrationId: "mangamillion",
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

  test("downloads and settles an artifact in browser mode", async ({
    context,
    extensionId,
    page,
  }) => {
    const series = MangaMillion.BASIC_SERIES.series
    const seriesUrl = `${MANGAMILLION_BASE_URL}/en/title/${series.seriesId}`

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
      (chapter) => chapter.locked !== true
    )
    if (!firstChapter) {
      throw new Error(
        `No downloadable chapter found for series ${series.seriesId}`
      )
    }

    const optionsPage = await openOptionsPage(context, extensionId)
    try {
      await persistBrowserModeDownloadSettings(optionsPage)

      const taskId = await startSingleChapterDownload(optionsPage, {
        sourceTabId: tabId,
        siteIntegrationId: "mangamillion",
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
      expect(typeof task.lastSuccessfulDownloadId).toBe("number")

      const artifact = await waitForBrowserDownloadArtifact(
        optionsPage,
        task.lastSuccessfulDownloadId!
      )
      expect(artifact.fileSize).toBeGreaterThan(0)
    } finally {
      await optionsPage.close()
    }
  })
})
