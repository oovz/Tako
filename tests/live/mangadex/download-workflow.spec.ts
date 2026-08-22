import { test, expect } from "../../e2e/fixtures/extension"
import { LIVE_MANGADEX_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import {
  loadLiveDownloadState,
  persistDownloadSettings,
  startSingleChapterDownload,
  waitForTerminalTask,
  assertTaskSucceeded,
  waitForBrowserDownload,
  expectZipArchiveFile,
  seedCustomDirectoryHandle,
  listSeededDirectoryFiles,
  seedMangadexWebsitePreferences,
  seedMangadexSessionPreferences,
} from "../fixtures/download-workflow-helpers"

test.describe("MangaDex download workflows (live)", () => {
  test.describe.configure({ timeout: 240_000 })

  test("completes a browser-mode live single-chapter download for MangaDex", async ({
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
    await page.goto(LIVE_MANGADEX_REFERENCE_URL, {
      waitUntil: "domcontentloaded",
    })
    await seedMangadexWebsitePreferences(page)

    const { optionsPage, tabId, state } = await loadLiveDownloadState(
      context,
      extensionId,
      page,
      "mangadex",
      {
        expectedMangaId: "db692d58-4b13-4174-ae8c-30c515c0689c",
        expectedSeriesTitle: "Hunter x Hunter",
        diagnosticEvents,
      }
    )
    await seedMangadexSessionPreferences(optionsPage, state.mangaId)

    try {
      await persistDownloadSettings(
        optionsPage,
        {
          destination: "downloads-api",
          customDirectoryHandleId: null,
          defaultFormat: "cbz",
          conflictPolicy: "overwrite",
        },
        {
          mangadex: {
            autoReadMangaDexSettings: true,
            imageQuality: "data-saver",
          },
        }
      )

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

  test("writes a live MangaDex single-chapter download through the custom-folder pipeline", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.goto(LIVE_MANGADEX_REFERENCE_URL, {
      waitUntil: "domcontentloaded",
    })
    await seedMangadexWebsitePreferences(page)

    const { optionsPage, tabId, state } = await loadLiveDownloadState(
      context,
      extensionId,
      page,
      "mangadex"
    )
    await seedMangadexSessionPreferences(optionsPage, state.mangaId)

    try {
      const seededDirectoryName = await seedCustomDirectoryHandle(optionsPage)

      await persistDownloadSettings(
        optionsPage,
        {
          destination: "file-system-access",
          defaultFormat: "cbz",
          conflictPolicy: "overwrite",
        },
        {
          mangadex: {
            autoReadMangaDexSettings: true,
            imageQuality: "data-saver",
          },
        }
      )

      const { taskId } = await startSingleChapterDownload(
        optionsPage,
        tabId,
        state
      )
      const task = await waitForTerminalTask(optionsPage, taskId)

      assertTaskSucceeded(task)

      const seededFiles = await listSeededDirectoryFiles(
        optionsPage,
        seededDirectoryName
      )
      expect(seededFiles.length).toBeGreaterThan(0)
      const cbzFile = seededFiles.find((file) => file.path.endsWith(".cbz"))
      expect(cbzFile).toBeTruthy()
      expect(cbzFile?.size).toBeGreaterThan(0)
    } finally {
      await optionsPage.close()
      await page.close()
    }
  })
})
