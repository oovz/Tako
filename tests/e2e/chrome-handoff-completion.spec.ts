import { readFile } from "node:fs/promises"
import { unzipSync } from "fflate"

import { test, expect } from "./fixtures/extension"
import { getTabId, waitForTabStateById } from "./fixtures/state-helpers"
import { MANGADEX_BASE_URL } from "./fixtures/test-domains-constants"
import { Mangadex } from "./fixtures/mock-data"
import { MOCK_IMAGES_PER_CHAPTER } from "./fixtures/mock-data/site-integrations/mangadex/image-fixtures"
import {
  openOptionsPage,
  persistBrowserModeDownloadSettings,
  seedMangadexSessionPreferences,
  startSingleChapterDownload,
  waitForBrowserDownloadArtifact,
  waitForTerminalTask,
} from "./fixtures/download-workflow-helpers"

test("completes Chrome handoff before transfer completion and retains history after erasure", async ({
  context,
  extensionId,
  page,
}) => {
  const series = Mangadex.BASIC_SERIES.series
  await page.goto(
    `${MANGADEX_BASE_URL}/title/${series.seriesId}/hunter-x-hunter`
  )
  const tabId = await getTabId(page, context)
  const state = await waitForTabStateById(
    page,
    context,
    tabId,
    (state) => Array.isArray(state.chapters) && state.chapters.length > 0
  )
  const chapter = state.chapters.find((chapter) => chapter.locked !== true)
  if (!chapter) throw new Error("No downloadable chapter in fixture")
  const options = await openOptionsPage(context, extensionId)
  try {
    const cdp = await context.newCDPSession(options)
    await cdp.send("Browser.setDownloadBehavior", {
      behavior: "default",
      eventsEnabled: true,
    })
    await seedMangadexSessionPreferences(options, series.seriesId)
    await persistBrowserModeDownloadSettings(options, {
      mangadex: { autoReadMangaDexSettings: true, imageQuality: "data" },
    })
    await options.evaluate(() => {
      const held = new Map<
        number,
        (suggestion?: chrome.downloads.FilenameSuggestion) => void
      >()
      chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
        if (!item.url.startsWith("blob:")) {
          suggest()
          return
        }
        held.set(item.id, suggest)
        return true
      })
      ;(
        window as unknown as { releaseDownload: (id: number) => void }
      ).releaseDownload = (id) => {
        const suggest = held.get(id)
        if (!suggest) throw new Error("Expected held filename determination")
        suggest()
        held.delete(id)
      }
    })
    const taskId = await startSingleChapterDownload(options, {
      sourceTabId: tabId,
      siteIntegrationId: "mangadex",
      mangaId: series.seriesId,
      seriesTitle: series.seriesTitle,
      chapter,
    })
    const task = await waitForTerminalTask(context, taskId)
    expect(task.status).toBe("completed")
    expect(task.chapters[0]).toMatchObject({
      outputDestination: "downloads-api",
      outputs: { requested: 1, committed: 1, failed: 0 },
    })
    const id = task.lastSuccessfulDownloadId
    if (id === undefined) throw new Error("Acknowledged download ID missing")
    const accepted = await options.evaluate(
      async (id) => (await chrome.downloads.search({ id }))[0],
      id
    )
    expect(accepted.state).toBe("in_progress")
    expect(
      await options.evaluate(
        async (url) => (await (await fetch(url)).blob()).size,
        accepted.url
      )
    ).toBeGreaterThan(0)
    await expect
      .poll(() =>
        options.evaluate(async (chapterId) => {
          const stored = await chrome.storage.local.get("downloadedChapters")
          if (!Array.isArray(stored.downloadedChapters)) return undefined
          return stored.downloadedChapters.find(
            (record: { chapterId: string }) => record.chapterId === chapterId
          )?.outputDestination
        }, chapter.id)
      )
      .toBe("downloads-api")
    await options
      .getByRole("button", { name: "Activity & History", exact: true })
      .click()
    await expect(
      options.getByText("Sent to Chrome", { exact: true }).first()
    ).toBeVisible()

    await options.evaluate(
      (id) =>
        (
          window as unknown as { releaseDownload: (id: number) => void }
        ).releaseDownload(id),
      id
    )
    const saved = await waitForBrowserDownloadArtifact(options, id)
    const entries = unzipSync(new Uint8Array(await readFile(saved.filename)))
    const images = Object.entries(entries).filter(([name]) =>
      /\.(png|jpe?g|webp)$/i.test(name)
    )
    expect(images).toHaveLength(
      MOCK_IMAGES_PER_CHAPTER + Number(task.settingsSnapshot.includeCoverImage)
    )
    expect(images.every(([, bytes]) => bytes.byteLength > 0)).toBe(true)
    await options.evaluate((id) => chrome.downloads.erase({ id }), id)
    expect(await waitForTerminalTask(context, taskId)).toEqual(task)
    expect(
      await options.evaluate(async (chapterId) => {
        const stored = await chrome.storage.local.get("downloadedChapters")
        if (!Array.isArray(stored.downloadedChapters)) return undefined
        return stored.downloadedChapters.find(
          (record: { chapterId: string }) => record.chapterId === chapterId
        )?.outputDestination
      }, chapter.id)
    ).toBe("downloads-api")
  } finally {
    await options.close()
  }
})
