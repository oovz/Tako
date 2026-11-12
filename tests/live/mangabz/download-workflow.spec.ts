import { test, expect } from "../../e2e/fixtures/extension"
import { LIVE_MANGABZ_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import {
  loadLiveDownloadState,
  persistDownloadSettings,
  startSingleChapterDownload,
  waitForTerminalTask,
  assertTaskSucceeded,
  expectBrowserChapterArchive,
} from "../fixtures/download-workflow-helpers"

test("saves a Mangabz chapter through Chrome Downloads", async ({
  context,
  extensionId,
}, testInfo) => {
  test.setTimeout(240_000)
  const page = await context.newPage()
  await page.goto(LIVE_MANGABZ_REFERENCE_URL, { waitUntil: "domcontentloaded" })
  const { optionsPage, tabId, state } = await loadLiveDownloadState(
    context,
    extensionId,
    page,
    "mangabz"
  )
  try {
    const score = await page.locator(".detail-info-stars > span").innerText()
    expect(score.trim()).toMatch(/^\d+(?:\.\d)?\s*分$/)
    expect(state.metadata?.communityRating).toBe(Number.parseFloat(score) / 2)
    await persistDownloadSettings(optionsPage, {
      destination: "downloads-api",
      customDirectoryHandleId: null,
      defaultFormat: "cbz",
      conflictPolicy: "overwrite",
    })
    const chapters = state.chapters.filter((chapter) => chapter.id === "29397")
    expect(chapters).toHaveLength(1)
    expect(chapters[0].locked).not.toBe(true)
    const { taskId } = await startSingleChapterDownload(optionsPage, tabId, {
      ...state,
      chapters,
    })
    const task = await waitForTerminalTask(optionsPage, taskId)
    assertTaskSucceeded(task)
    await expectBrowserChapterArchive(
      optionsPage,
      task,
      LIVE_MANGABZ_REFERENCE_URL,
      testInfo
    )
  } finally {
    await optionsPage.close()
    await page.close()
  }
})
