import { test, expect } from "../../e2e/fixtures/extension"
import { LIVE_DM5_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import {
  loadLiveDownloadState,
  persistDownloadSettings,
  startSingleChapterDownload,
  waitForTerminalTask,
  assertTaskSucceeded,
  expectBrowserChapterArchive,
} from "../fixtures/download-workflow-helpers"

test("saves a DM5 chapter through Chrome Downloads", async ({
  context,
  extensionId,
}, testInfo) => {
  test.setTimeout(240_000)
  const page = await context.newPage()
  await page.goto(LIVE_DM5_REFERENCE_URL, { waitUntil: "domcontentloaded" })
  const { optionsPage, tabId, state } = await loadLiveDownloadState(
    context,
    extensionId,
    page,
    "animemangahouse"
  )
  try {
    const score = await page
      .locator(".banner_detail_form .title .score")
      .innerText()
    expect(score.trim()).toMatch(/^\d+(?:\.\d)?\s*分$/)
    expect(state.metadata?.communityRating).toBe(Number.parseFloat(score) / 2)
    const serialGroup = await page
      .locator("#tempc > .detail-list-title > a.block")
      .innerText()
    const count = serialGroup.match(/连载\s*（(\d+)）/)?.[1]
    expect(count).toBeDefined()
    expect(state.metadata?.chapterCount).toBe(Number(count))
    await persistDownloadSettings(optionsPage, {
      destination: "downloads-api",
      customDirectoryHandleId: null,
      defaultFormat: "cbz",
      conflictPolicy: "overwrite",
    })
    const chapters = state.chapters.filter((chapter) => chapter.id === "521974")
    expect(chapters).toHaveLength(1)
    expect(chapters[0].locked).not.toBe(true)
    const date = await page
      .locator('#chapterlistload a[href="/m521974/"] .info > .tip')
      .textContent()
    expect(date?.trim()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(chapters[0].releaseDate).toBe(date?.trim())
    const { taskId } = await startSingleChapterDownload(optionsPage, tabId, {
      ...state,
      chapters,
    })
    const task = await waitForTerminalTask(optionsPage, taskId)
    assertTaskSucceeded(task)
    await expectBrowserChapterArchive(
      optionsPage,
      task,
      LIVE_DM5_REFERENCE_URL,
      testInfo
    )
  } finally {
    await optionsPage.close()
    await page.close()
  }
})
