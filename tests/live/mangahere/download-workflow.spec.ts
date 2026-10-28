import { installPageDiagnostics } from "../../e2e/fixtures/diagnostics"
import { test, expect } from "../../e2e/fixtures/extension"
import { LIVE_MANGAHERE_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import {
  loadLiveDownloadState,
  persistDownloadSettings,
  startSingleChapterDownload,
  waitForTerminalTask,
  assertTaskSucceeded,
  expectBrowserChapterArchive,
  createDiagnosticEventRecorder,
} from "../fixtures/download-workflow-helpers"

test("saves a MangaHere chapter through Chrome Downloads", async ({
  context,
  extensionId,
}, testInfo) => {
  const page = await context.newPage()
  const { diagnosticEvents, recordDiagnostic } = createDiagnosticEventRecorder()
  installPageDiagnostics(page, recordDiagnostic)
  await page.goto(LIVE_MANGAHERE_REFERENCE_URL, {
    waitUntil: "domcontentloaded",
  })
  const { optionsPage, tabId, state } = await loadLiveDownloadState(
    context,
    extensionId,
    page,
    "mangahere",
    { diagnosticEvents }
  )
  try {
    await persistDownloadSettings(optionsPage, {
      destination: "downloads-api",
      customDirectoryHandleId: null,
      defaultFormat: "cbz",
      conflictPolicy: "overwrite",
    })
    const chapters = state.chapters.filter(
      (chapter) => chapter.id === "hunter_x_hunter/v01/c001"
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
      LIVE_MANGAHERE_REFERENCE_URL,
      testInfo
    )
  } finally {
    await optionsPage.close()
    await page.close()
  }
})
