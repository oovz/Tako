import { installPageDiagnostics } from "../../e2e/fixtures/diagnostics"
import { test, expect } from "../../e2e/fixtures/extension"
import { LIVE_COMICNETTAI_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import {
  loadLiveDownloadState,
  persistDownloadSettings,
  startSingleChapterDownload,
  waitForTerminalTask,
  assertTaskSucceeded,
  waitForBrowserDownload,
  expectZipArchiveFile,
  createDiagnosticEventRecorder,
} from "../fixtures/download-workflow-helpers"

test.describe("Comic Nettai download workflows (live)", () => {
  test.describe.configure({ timeout: 240_000 })

  test("completes a browser-mode live single-chapter download for Comic Nettai", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    const { diagnosticEvents, recordDiagnostic } =
      createDiagnosticEventRecorder()
    installPageDiagnostics(page, recordDiagnostic)
    await page.goto(LIVE_COMICNETTAI_REFERENCE_URL, {
      waitUntil: "domcontentloaded",
    })

    const { optionsPage, tabId, state } = await loadLiveDownloadState(
      context,
      extensionId,
      page,
      "comicnettai",
      {
        expectedMangaId: "9",
        expectedSeriesTitle: "煙たい話",
        diagnosticEvents,
      }
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
      expect(typeof task.lastSuccessfulDownloadId).toBe("number")

      const downloadItem = await waitForBrowserDownload(
        optionsPage,
        task.lastSuccessfulDownloadId as number
      )
      expect(downloadItem.state).toBe("complete")
      expect(downloadItem.exists).toBe(true)
      await expectZipArchiveFile(downloadItem.filename)
    } finally {
      await optionsPage.close()
      await page.close()
    }
  })
})
