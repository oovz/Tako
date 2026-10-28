import { test } from "../../e2e/fixtures/extension"
import { LIVE_ZAIMANHUA_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import {
  loadLiveDownloadState,
  persistDownloadSettings,
  startSingleChapterDownload,
  waitForTerminalTask,
  assertTaskSucceeded,
  expectBrowserChapterArchive,
} from "../fixtures/download-workflow-helpers"

test.describe("Manga Again downloads (live)", () => {
  test.describe.configure({ timeout: 240_000 })
  test("saves a free chapter through Chrome Downloads", async ({
    context,
    extensionId,
  }, testInfo) => {
    const page = await context.newPage()
    await page.goto(LIVE_ZAIMANHUA_REFERENCE_URL, {
      waitUntil: "domcontentloaded",
    })
    const { optionsPage, tabId, state } = await loadLiveDownloadState(
      context,
      extensionId,
      page,
      "mangaagain"
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
        chapters: state.chapters.filter((chapter) => chapter.id === "195373"),
      }
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
        LIVE_ZAIMANHUA_REFERENCE_URL,
        testInfo
      )
    } finally {
      await optionsPage.close()
      await page.close()
    }
  })
})
