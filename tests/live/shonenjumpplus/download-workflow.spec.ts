import { installPageDiagnostics } from "../../e2e/fixtures/diagnostics"
import { test } from "../../e2e/fixtures/extension"
import { LIVE_SHONENJUMPPLUS_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import {
  loadLiveDownloadState,
  persistDownloadSettings,
  startSingleChapterDownload,
  waitForTerminalTask,
  assertTaskSucceeded,
  expectBrowserChapterArchive,
  createDiagnosticEventRecorder,
} from "../fixtures/download-workflow-helpers"

test.describe("Shonen Jump+ download workflows (live)", () => {
  test.describe.configure({ timeout: 240_000 })

  test("saves a chapter through Chrome Downloads", async ({
    context,
    extensionId,
  }, testInfo) => {
    const page = await context.newPage()
    const { diagnosticEvents, recordDiagnostic } =
      createDiagnosticEventRecorder()
    installPageDiagnostics(page, recordDiagnostic)
    await page.goto(LIVE_SHONENJUMPPLUS_REFERENCE_URL, {
      waitUntil: "domcontentloaded",
    })

    const { optionsPage, tabId, state } = await loadLiveDownloadState(
      context,
      extensionId,
      page,
      "shonenjumpplus",
      { diagnosticEvents }
    )

    try {
      await persistDownloadSettings(optionsPage, {
        destination: "downloads-api",
        customDirectoryHandleId: null,
        defaultFormat: "cbz",
        conflictPolicy: "overwrite",
      })

      const { taskId } = await startSingleChapterDownload(
        optionsPage,
        tabId,
        state
      )
      const task = await waitForTerminalTask(optionsPage, taskId)

      assertTaskSucceeded(task)
      await expectBrowserChapterArchive(
        optionsPage,
        task,
        LIVE_SHONENJUMPPLUS_REFERENCE_URL,
        testInfo
      )
    } finally {
      await optionsPage.close()
      await page.close()
    }
  })
})
