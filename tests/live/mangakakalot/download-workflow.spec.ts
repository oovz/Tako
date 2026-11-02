import { test, expect } from "../../e2e/fixtures/extension"
import { LIVE_MANGAKAKALOT_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import {
  loadLiveDownloadState,
  persistDownloadSettings,
  startSingleChapterDownload,
  waitForTerminalTask,
  assertTaskSucceeded,
  expectBrowserChapterArchive,
} from "../fixtures/download-workflow-helpers"

test("saves a free MangaKakalot chapter through Chrome Downloads", async ({
  context,
  extensionId,
}, testInfo) => {
  test.setTimeout(240_000)
  const page = await context.newPage()
  await page.goto(LIVE_MANGAKAKALOT_REFERENCE_URL, {
    waitUntil: "domcontentloaded",
  })
  const { optionsPage, tabId, state } = await loadLiveDownloadState(
    context,
    extensionId,
    page,
    "mangakakalot"
  )
  try {
    await persistDownloadSettings(optionsPage, {
      destination: "downloads-api",
      customDirectoryHandleId: null,
      defaultFormat: "cbz",
      conflictPolicy: "overwrite",
    })
    const chapters = state.chapters.filter(
      (chapter) => chapter.id === "chapter-0"
    )
    expect(chapters).toHaveLength(1)
    const { taskId } = await startSingleChapterDownload(optionsPage, tabId, {
      ...state,
      chapters,
    })
    const task = await waitForTerminalTask(optionsPage, taskId)
    assertTaskSucceeded(task)
    await expectBrowserChapterArchive(
      optionsPage,
      task,
      LIVE_MANGAKAKALOT_REFERENCE_URL,
      testInfo
    )
  } finally {
    await optionsPage.close()
    await page.close()
  }
})
