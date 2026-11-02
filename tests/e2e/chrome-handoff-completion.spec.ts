import { readFile } from "node:fs/promises"
import { unzipSync } from "fflate"

import { test, expect } from "./fixtures/extension"
import {
  getTabId,
  waitForTabStateById,
  waitForTabSeriesTitle,
} from "./fixtures/state-helpers"
import { MANGADEX_BASE_URL } from "./fixtures/test-domains-constants"
import { Mangadex } from "./fixtures/mock-data"
import {
  buildAtHomeServerResponse,
  MANGADEX_CAPTURED_READER_ID,
} from "./fixtures/mock-data/site-integrations/mangadex/image-fixtures"
import type { DownloadTaskState } from "@/src/domain/queue/state"
import {
  openOptionsPage,
  persistBrowserModeDownloadSettings,
  seedMangadexSessionPreferences,
  startSingleChapterDownload,
  waitForBrowserDownloadArtifact,
  waitForTerminalTask,
} from "./fixtures/download-workflow-helpers"

for (const outcome of ["complete", "interrupted"] as const) {
  test(`waits for Chrome's final ${outcome} result before recording saved output`, async ({
    context,
    extensionId,
    page,
  }) => {
    const series = Mangadex.BASIC_SERIES.series
    await page.goto(
      `${MANGADEX_BASE_URL}/title/${series.seriesId}/hunter-x-hunter`
    )
    const tabId = await getTabId(page, context)
    await waitForTabSeriesTitle(context, tabId, series.seriesTitle)
    const state = await waitForTabStateById(page, context, tabId, (state) =>
      state.chapters.some(
        (chapter) => chapter.id === MANGADEX_CAPTURED_READER_ID
      )
    )
    const chapter = state.chapters.find(
      (chapter) => chapter.id === MANGADEX_CAPTURED_READER_ID
    )
    if (!chapter) throw new Error("No downloadable chapter in fixture")
    const options = await openOptionsPage(context, extensionId)
    try {
      const cdp = await context.newCDPSession(options)
      await cdp.send("Browser.setDownloadBehavior", {
        behavior: "default",
        eventsEnabled: true,
      })
      await seedMangadexSessionPreferences(options, series.seriesId, ["es-la"])
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
        Object.assign(window, {
          heldDownloadIds: () => [...held.keys()],
          releaseDownload: (id: number) => {
            const suggest = held.get(id)
            if (!suggest)
              throw new Error("Expected held filename determination")
            suggest()
            held.delete(id)
          },
        })
      })
      const taskId = await startSingleChapterDownload(options, {
        sourceTabId: tabId,
        siteIntegrationId: "mangadex",
        mangaId: series.seriesId,
        seriesTitle: series.seriesTitle,
        chapter,
      })
      const heldIds = () =>
        options.evaluate(() =>
          (
            window as unknown as { heldDownloadIds: () => number[] }
          ).heldDownloadIds()
        )
      // Chrome receives the archive after all declared pages are processed.
      await expect
        .poll(async () => (await heldIds()).length, {
          timeout: test.info().timeout,
        })
        .toBe(1)
      const id = (await heldIds())[0]!
      const accepted = await options.evaluate(
        async (id) => (await chrome.downloads.search({ id }))[0],
        id
      )
      expect(accepted.state).toBe("in_progress")
      const pending = await options.evaluate(async (taskId) => {
        const { downloadQueue } =
          await chrome.storage.local.get("downloadQueue")
        return (downloadQueue as DownloadTaskState[]).find(
          (task) => task.id === taskId
        )
      }, taskId)
      expect(pending).toMatchObject({
        status: "downloading",
        chapters: [{ status: "downloading" }],
      })
      expect(pending?.lastSuccessfulDownloadId).toBeUndefined()
      expect(pending?.chapters[0]?.saveConfirmedAt).toBeUndefined()
      const savedRecord = () =>
        options.evaluate(async (chapterId) => {
          const { downloadedChapters } =
            await chrome.storage.local.get("downloadedChapters")
          return Array.isArray(downloadedChapters)
            ? downloadedChapters.find(
                (record: { chapterId: string; saveConfirmedAt?: number }) =>
                  record.chapterId === chapterId
              )
            : undefined
        }, chapter.id)
      expect(await savedRecord()).toBeUndefined()
      expect(
        await options.evaluate(
          async (url) => (await (await fetch(url)).blob()).size,
          accepted.url
        )
      ).toBeGreaterThan(0)
      await options
        .getByRole("button", { name: "Activity & History", exact: true })
        .click()
      await expect(options.getByText("Saved", { exact: true })).toHaveCount(0)
      if (outcome === "complete") {
        await options.evaluate(
          (id) =>
            (
              window as unknown as { releaseDownload: (id: number) => void }
            ).releaseDownload(id),
          id
        )
        const saved = await waitForBrowserDownloadArtifact(options, id)
        const task = await waitForTerminalTask(context, taskId)
        expect(task).toMatchObject({
          status: "completed",
          lastSuccessfulDownloadId: id,
          chapters: [
            {
              outputDestination: "downloads-api",
              saveConfirmedAt: expect.any(Number),
              outputs: { requested: 1, committed: 1, failed: 0 },
            },
          ],
        })
        const entries = unzipSync(
          new Uint8Array(await readFile(saved.filename))
        )
        const images = Object.entries(entries).filter(([name]) =>
          /\.(png|jpe?g|webp)$/i.test(name)
        )
        expect(images).toHaveLength(
          buildAtHomeServerResponse(chapter.id).chapter.data.length +
            Number(task.settingsSnapshot.includeCoverImage)
        )
        expect(images.every(([, bytes]) => bytes.byteLength > 0)).toBe(true)
        await expect.poll(savedRecord).toMatchObject({
          outputDestination: "downloads-api",
          saveConfirmedAt: expect.any(Number),
        })
        await expect(
          options.getByText("Saved", { exact: true }).first()
        ).toBeVisible()
        await options.evaluate((id) => chrome.downloads.erase({ id }), id)
        expect(await waitForTerminalTask(context, taskId)).toEqual(task)
        expect(await savedRecord()).toMatchObject({
          saveConfirmedAt: task.chapters[0]?.saveConfirmedAt,
        })
      } else {
        await options.evaluate((id) => chrome.downloads.cancel(id), id)
        const task = await waitForTerminalTask(context, taskId)
        expect(task).toMatchObject({
          status: "failed",
          errorCategory: "browser_download_interrupted",
          chapters: [
            {
              status: "failed",
              errorCategory: "browser_download_interrupted",
              outputs: { requested: 1, committed: 0, failed: 1 },
            },
          ],
        })
        expect(task.chapters[0]?.saveConfirmedAt).toBeUndefined()
        expect(await savedRecord()).toBeUndefined()
        await expect(
          options
            .getByText("Chrome could not finish saving the output.", {
              exact: false,
            })
            .first()
        ).toBeVisible()
      }
    } finally {
      await options.close()
    }
  })
}
