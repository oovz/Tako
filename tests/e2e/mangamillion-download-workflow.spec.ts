import { test, expect } from "./fixtures/extension"
import {
  getTabId,
  waitForTabSeriesTitle,
  waitForTabStateById,
} from "./fixtures/state-helpers"
import { MANGAMILLION_BASE_URL } from "./fixtures/test-domains-constants"
import { MangaMillion } from "./fixtures/mock-data"
import { MANGAMILLION_LOCAL_API_PREFIX } from "./fixtures/mock-data/site-integrations/mangamillion/local-server"
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

test.describe("MangaMillion downloads", () => {
  test.describe.configure({ timeout: 120_000 })

  test("decrypts and saves a complete chapter in the selected folder", async ({
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

  test("downloads with the catalog device token when a second registration is denied", async ({
    context,
    extensionId,
    page,
    _extensionContextState,
  }) => {
    const mockServer = _extensionContextState.localMockServer!
    let registrations = 0
    mockServer.addRoute(`${MANGAMILLION_LOCAL_API_PREFIX}/api/register`, () => {
      registrations += 1
      return registrations === 1
        ? {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
            body: MangaMillion.buildMangaMillionRegisterResponse(),
          }
        : { status: 403, body: "Forbidden" }
    })
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
      expect(registrations).toBe(1)
    } finally {
      await optionsPage.close()
    }
  })
})
