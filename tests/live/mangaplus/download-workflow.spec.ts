import { expect } from "@playwright/test"
import { test } from "../../e2e/fixtures/extension"
import { LIVE_MANGAPLUS_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import {
  loadLiveDownloadState,
  persistDownloadSettings,
  startSingleChapterDownload,
  waitForTerminalTask,
  assertTaskSucceeded,
  expectBrowserChapterArchive,
} from "../fixtures/download-workflow-helpers"

test("saves a free MANGA Plus chapter through Chrome Downloads", async ({
  context,
  extensionId,
}, testInfo) => {
  const page = await context.newPage()
  await page.goto(LIVE_MANGAPLUS_REFERENCE_URL, {
    waitUntil: "domcontentloaded",
  })
  const { optionsPage, tabId, state } = await loadLiveDownloadState(
    context,
    extensionId,
    page,
    "mangaplus",
    { expectedMangaId: "100467", expectedSeriesTitle: "Home at the Horizon" }
  )
  try {
    await persistDownloadSettings(optionsPage, {
      destination: "downloads-api",
      customDirectoryHandleId: null,
      defaultFormat: "cbz",
      conflictPolicy: "overwrite",
    })
    const selected = {
      ...state,
      chapters: state.chapters.filter((chapter) => chapter.id === "1030661"),
    }
    expect(selected.chapters).toHaveLength(1)
    const { taskId } = await startSingleChapterDownload(
      optionsPage,
      tabId,
      selected
    )
    const task = await waitForTerminalTask(optionsPage, taskId)
    assertTaskSucceeded(task)
    await expectBrowserChapterArchive(
      optionsPage,
      task,
      LIVE_MANGAPLUS_REFERENCE_URL,
      testInfo
    )
  } finally {
    await optionsPage.close()
    await page.close()
  }
})
