import { installPageDiagnostics } from "../../e2e/fixtures/diagnostics"
import { test, expect } from "../../e2e/fixtures/extension"
import { readSeededDirectoryFile } from "../../e2e/fixtures/download-workflow-helpers"
import { LIVE_MANGADEX_REFERENCE_URL } from "../../e2e/fixtures/test-domains-constants"
import {
  loadLiveDownloadState,
  persistDownloadSettings,
  startSingleChapterDownload,
  waitForTerminalTask,
  assertTaskSucceeded,
  expectBrowserChapterArchive,
  expectSavedChapterArchive,
  seedCustomDirectoryHandle,
  listSeededDirectoryFiles,
  seedMangadexWebsitePreferences,
  seedMangadexSessionPreferences,
  createDiagnosticEventRecorder,
} from "../fixtures/download-workflow-helpers"

test.describe("MangaDex download workflows (live)", () => {
  test.describe.configure({ timeout: 240_000 })

  test("saves a chapter through Chrome Downloads", async ({
    context,
    extensionId,
  }, testInfo) => {
    const page = await context.newPage()
    const { diagnosticEvents, recordDiagnostic } =
      createDiagnosticEventRecorder()
    installPageDiagnostics(page, recordDiagnostic)
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
      await expectBrowserChapterArchive(
        optionsPage,
        task,
        LIVE_MANGADEX_REFERENCE_URL,
        testInfo
      )
    } finally {
      await optionsPage.close()
      await page.close()
    }
  })

  test("saves a chapter to a custom folder", async ({
    context,
    extensionId,
  }, testInfo) => {
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
          customDirectoryHandleId: "download-root",
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
      const bytes = await readSeededDirectoryFile(
        optionsPage,
        seededDirectoryName,
        cbzFile!.path
      )
      await expectSavedChapterArchive(
        optionsPage,
        bytes,
        task,
        LIVE_MANGADEX_REFERENCE_URL,
        testInfo
      )
    } finally {
      await optionsPage.close()
      await page.close()
    }
  })
})
