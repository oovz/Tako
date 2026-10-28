import { installPageDiagnostics } from "../../e2e/fixtures/diagnostics"
import { test, expect } from "../../e2e/fixtures/extension"
import { LIVE_AIMANHUA_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import {
  loadLiveDownloadState,
  persistDownloadSettings,
  startSingleChapterDownload,
  waitForTerminalTask,
  assertTaskSucceeded,
  expectBrowserChapterArchive,
  createDiagnosticEventRecorder,
} from "../fixtures/download-workflow-helpers"

test("completes a browser-mode live single-chapter download for Aimanhua", async ({
  context,
  extensionId,
}, testInfo) => {
  test.setTimeout(600_000)
  const page = await context.newPage()
  const { diagnosticEvents, recordDiagnostic } = createDiagnosticEventRecorder()
  installPageDiagnostics(page, recordDiagnostic)
  await page.goto(LIVE_AIMANHUA_REFERENCE_URL, {
    waitUntil: "domcontentloaded",
  })
  const { optionsPage, tabId, state } = await loadLiveDownloadState(
    context,
    extensionId,
    page,
    "lovemanga",
    { diagnosticEvents }
  )
  try {
    await persistDownloadSettings(optionsPage, {
      destination: "downloads-api",
      customDirectoryHandleId: null,
      defaultFormat: "cbz",
      conflictPolicy: "overwrite",
    })
    const chapters = state.chapters.filter((chapter) => chapter.id === "221966")
    expect(chapters).toHaveLength(1)
    const { taskId } = await startSingleChapterDownload(optionsPage, tabId, {
      ...state,
      chapters,
    })
    const task = await waitForTerminalTask(optionsPage, taskId, 480_000)
    assertTaskSucceeded(task)
    await expectBrowserChapterArchive(
      optionsPage,
      task,
      LIVE_AIMANHUA_REFERENCE_URL,
      testInfo
    )
  } finally {
    await optionsPage.close()
    await page.close()
  }
})
