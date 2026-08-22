import { test, expect } from "../../e2e/fixtures/extension"
import { LIVE_PIXIV_COMIC_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import {
  loadLiveDownloadState,
  persistDownloadSettings,
  startSingleChapterDownload,
  waitForTerminalTask,
  assertTaskSucceeded,
  waitForBrowserDownload,
  expectZipArchiveFile,
} from "../fixtures/download-workflow-helpers"

test.describe("Pixiv Comic download workflows (live)", () => {
  test.describe.configure({ timeout: 240_000 })

  test("completes a browser-mode live single-chapter download for Pixiv Comic", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    const diagnosticEvents: string[] = []
    const recordDiagnostic = (message: string) => {
      if (diagnosticEvents.length < 20) diagnosticEvents.push(message)
    }
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        recordDiagnostic(`console:${message.type()}:${message.text()}`)
      }
    })
    page.on("pageerror", (error) => {
      recordDiagnostic(`pageerror:${error.message}`)
    })
    page.on("requestfailed", (request) => {
      recordDiagnostic(
        `requestfailed:${request.url()}:${request.failure()?.errorText ?? "unknown"}`
      )
    })
    await page.goto(LIVE_PIXIV_COMIC_REFERENCE_URL, {
      waitUntil: "domcontentloaded",
    })

    const { optionsPage, tabId, state } = await loadLiveDownloadState(
      context,
      extensionId,
      page,
      "pixiv-comic",
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
