import { installPageDiagnostics } from "../../e2e/fixtures/diagnostics"
import { expect } from "@playwright/test"
import { test } from "../../e2e/fixtures/extension"
import { LIVE_MANGAGO_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import {
  loadLiveDownloadState,
  persistDownloadSettings,
  startSingleChapterDownload,
  waitForTerminalTask,
  assertTaskSucceeded,
  expectBrowserChapterArchive,
  createDiagnosticEventRecorder,
} from "../fixtures/download-workflow-helpers"

test.describe("Mangago download workflow (live)", () => {
  test("saves the selected free chapter through Chrome Downloads", async ({
    context,
    extensionId,
  }, testInfo) => {
    const page = await context.newPage()
    const { diagnosticEvents, recordDiagnostic } =
      createDiagnosticEventRecorder()
    installPageDiagnostics(page, recordDiagnostic)
    await page.goto(LIVE_MANGAGO_REFERENCE_URL, {
      waitUntil: "domcontentloaded",
    })
    const { optionsPage, tabId, state } = await loadLiveDownloadState(
      context,
      extensionId,
      page,
      "mangago",
      { diagnosticEvents }
    )
    try {
      const chapters = state.chapters.filter(
        (chapter) => chapter.id === "nbt:br_chapter-454512" && !chapter.locked
      )
      expect(
        chapters,
        "The reference chapter must remain publicly selectable"
      ).toHaveLength(1)
      await persistDownloadSettings(optionsPage, {
        destination: "downloads-api",
        customDirectoryHandleId: null,
        defaultFormat: "cbz",
        conflictPolicy: "overwrite",
      })
      const { taskId } = await startSingleChapterDownload(optionsPage, tabId, {
        ...state,
        chapters,
      })
      const task = await waitForTerminalTask(optionsPage, taskId)
      assertTaskSucceeded(task)
      await expectBrowserChapterArchive(
        optionsPage,
        task,
        LIVE_MANGAGO_REFERENCE_URL,
        testInfo
      )
    } finally {
      await optionsPage.close()
      await page.close()
    }
  })
})
