import { readFile } from "node:fs/promises"
import { unzipSync } from "fflate"
/**
 * @file mangadex-download-workflow.spec.ts
 * @description Download-workflow coverage for the MangaDex
 * integration.
 *
 * Exercises the full pipeline end-to-end without live network:
 *
 *   series page -> tab state -> chapter-feed -> at-home server
 *                     -> image bytes -> offscreen archive -> OPFS cbz
 *
 * Assertions target the canonical success signals the live spec checks:
 * task reaches `completed`/`partial_success`, and at least one non-empty
 * `.cbz` artifact appears in the seeded OPFS directory. A regression in
 * MangaDex chapter-image URL resolution, at-home retry logic, or archive
 * assembly will flip this spec red before it reaches production.
 */

import { test, expect } from "./fixtures/extension"
import {
  getTabId,
  openSidepanelHarness,
  waitForTabSeriesTitle,
  waitForTabStateById,
} from "./fixtures/state-helpers"
import { MANGADEX_BASE_URL } from "./fixtures/test-domains-constants"
import { Mangadex } from "./fixtures/mock-data"
import { createCommandEnvelope } from "@/src/runtime/command-envelope"
import type { RuntimeMessageResponse } from "@/src/runtime/runtime-message-contracts"
import { MANGADEX_LOCAL_API_PREFIX } from "./fixtures/mock-data/site-integrations/mangadex/local-server"
import {
  buildAtHomeServerResponse,
  MANGADEX_CAPTURED_READER_ID,
} from "./fixtures/mock-data/site-integrations/mangadex/image-fixtures"
import {
  assertTaskSucceeded,
  openOptionsPage,
  persistCustomModeDownloadSettings,
  seedCustomDirectoryHandle,
  seedMangadexSessionPreferences,
  startSingleChapterDownload,
  waitForBrowserDownloadArtifact,
  waitForCbzArtifact,
  waitForTerminalTask,
} from "./fixtures/download-workflow-helpers"

test.describe("MangaDex download workflow (mocked)", () => {
  test.describe.configure({ timeout: 120_000 })

  test("saves through Chrome when an opted-in task has no folder capability before writing", async ({
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
      await seedCustomDirectoryHandle(options)
      await persistCustomModeDownloadSettings(options, {
        mangadex: { autoReadMangaDexSettings: true, imageQuality: "data" },
      })
      await options.evaluate(async (command) => {
        const current: RuntimeMessageResponse<"GET_OPTIONS_CONFIGURATION"> =
          await chrome.runtime.sendMessage({
            target: "background",
            type: "GET_OPTIONS_CONFIGURATION",
          })
        if (!current.success) throw new Error(current.error)
        const configuration = current.data.configuration
        configuration.settings.downloads.allowChromeFallback = true
        const saved: RuntimeMessageResponse<"SAVE_OPTIONS_CONFIGURATION"> =
          await chrome.runtime.sendMessage({
            target: "background",
            type: "SAVE_OPTIONS_CONFIGURATION",
            ...command,
            payload: { configuration },
          })
        if (!saved.success) throw new Error(saved.error)
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("tako-fs")
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction("handles", "readwrite")
            tx.objectStore("handles").delete("download-root")
            tx.oncomplete = () => resolve()
            tx.onabort = tx.onerror = () => reject(tx.error)
          })
        } finally {
          db.close()
        }
      }, createCommandEnvelope())
      const taskId = await startSingleChapterDownload(options, {
        sourceTabId: tabId,
        siteIntegrationId: "mangadex",
        mangaId: series.seriesId,
        seriesTitle: series.seriesTitle,
        chapter,
      })
      const task = await waitForTerminalTask(context, taskId)
      expect(task).toMatchObject({
        status: "completed",
        useChromeFallback: true,
        settingsSnapshot: {
          allowChromeFallback: true,
          destination: {
            kind: "file-system-access",
            handleId: "download-root",
          },
        },
        chapters: [
          {
            outputDestination: "downloads-api",
            saveConfirmedAt: expect.any(Number),
            outputs: { requested: 1, committed: 1, failed: 0 },
          },
        ],
      })
      const artifact = await waitForBrowserDownloadArtifact(
        options,
        task.lastSuccessfulDownloadId!
      )
      expect(artifact.fileSize).toBeGreaterThan(0)
      const contents = unzipSync(
        new Uint8Array(await readFile(artifact.filename))
      )
      expect(
        Object.entries(contents).some(
          ([name, bytes]) =>
            /\.(png|jpe?g|webp)$/i.test(name) && bytes.length > 0
        )
      ).toBe(true)
      await options
        .getByRole("button", { name: "Activity & History", exact: true })
        .click()
      await expect(
        options.getByText("Switched to Chrome Downloads", { exact: false })
      ).toBeVisible()
      await expect(
        options.getByText("Saved", { exact: true }).first()
      ).toBeVisible()
      await expect
        .poll(() =>
          options.evaluate(async (chapterId) => {
            const { downloadedChapters } =
              await chrome.storage.local.get("downloadedChapters")
            return Array.isArray(downloadedChapters)
              ? downloadedChapters.find(
                  (record: { chapterId: string }) =>
                    record.chapterId === chapterId
                )
              : undefined
          }, chapter.id)
        )
        .toMatchObject({
          outputDestination: "downloads-api",
          saveConfirmedAt: expect.any(Number),
        })
    } finally {
      await options.close()
    }
  })

  for (const change of ["replace-folder", "downloads-api"] as const) {
    test(`keeps the admitted folder when settings ${change} during chapter resolution`, async ({
      context,
      extensionId,
      page,
      _extensionContextState,
    }) => {
      const series = Mangadex.BASIC_SERIES.series
      const seriesUrl = `${MANGADEX_BASE_URL}/title/${series.seriesId}/hunter-x-hunter`

      await page.goto(seriesUrl, { waitUntil: "domcontentloaded" })
      const tabId = await getTabId(page, context)

      // Wait for content-script-driven tab state to populate so the download
      // message has a valid tab reference + chapter list to pick from.
      await waitForTabSeriesTitle(context, tabId, series.seriesTitle)
      const tabState = await waitForTabStateById(
        page,
        context,
        tabId,
        (state) => Array.isArray(state.chapters) && state.chapters.length > 0
      )

      const firstChapter = tabState.chapters.find(
        (chapter) => chapter.id === MANGADEX_CAPTURED_READER_ID
      )
      if (!firstChapter) {
        throw new Error(
          `No downloadable chapter found for series ${series.seriesId}`
        )
      }

      const optionsPage = await openOptionsPage(context, extensionId)
      let releasePlan!: () => void
      const planReady = new Promise<void>((resolve) => {
        releasePlan = resolve
      })
      let planRequested = false
      const server = _extensionContextState.localMockServer
      if (!server)
        throw new Error("Deterministic chapter server is unavailable")
      server.addRoute(
        `${MANGADEX_LOCAL_API_PREFIX}/at-home/server`,
        async (request) => {
          planRequested = true
          await planReady
          return {
            status: 200,
            body: buildAtHomeServerResponse(
              request.pathnameAfterPrefix.slice(1)
            ),
          }
        }
      )
      try {
        await seedMangadexSessionPreferences(optionsPage, series.seriesId, [
          "es-la",
        ])
        const seededDirectoryName = await seedCustomDirectoryHandle(optionsPage)
        await persistCustomModeDownloadSettings(optionsPage, {
          mangadex: {
            autoReadMangaDexSettings: true,
            imageQuality: "data",
          },
        })

        const taskId = await startSingleChapterDownload(optionsPage, {
          sourceTabId: tabId,
          siteIntegrationId: "mangadex",
          mangaId: series.seriesId,
          seriesTitle: series.seriesTitle,
          chapter: {
            id: firstChapter.id,
            title: firstChapter.title,
            url: firstChapter.url,
            index: firstChapter.index,
            chapterLabel: firstChapter.chapterLabel,
            chapterNumber: firstChapter.chapterNumber,
            volumeLabel: firstChapter.volumeLabel,
            volumeNumber: firstChapter.volumeNumber,
            language: firstChapter.language,
          },
        })

        await expect.poll(() => planRequested).toBe(true)
        await optionsPage.evaluate(
          async ({ change, command }) => {
            const current: RuntimeMessageResponse<"GET_OPTIONS_CONFIGURATION"> =
              await chrome.runtime.sendMessage({
                target: "background",
                type: "GET_OPTIONS_CONFIGURATION",
              })
            if (!current.success) throw new Error(current.error)
            const configuration = current.data.configuration
            if (change === "replace-folder") {
              const root = await navigator.storage.getDirectory()
              const replacement = await root.getDirectoryHandle(
                "replacement-folder",
                { create: true }
              )
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open("tako-fs")
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => reject(request.error)
              })
              try {
                await new Promise<void>((resolve, reject) => {
                  const tx = db.transaction("handles", "readwrite")
                  tx.objectStore("handles").put(
                    replacement,
                    "replacement-folder"
                  )
                  tx.oncomplete = () => resolve()
                  tx.onabort = tx.onerror = () => reject(tx.error)
                })
              } finally {
                db.close()
              }
              configuration.settings.downloads.customDirectoryHandleId =
                "replacement-folder"
            } else {
              configuration.settings.downloads.destination = "downloads-api"
              configuration.settings.downloads.customDirectoryHandleId = null
            }
            const saved: RuntimeMessageResponse<"SAVE_OPTIONS_CONFIGURATION"> =
              await chrome.runtime.sendMessage({
                target: "background",
                type: "SAVE_OPTIONS_CONFIGURATION",
                ...command,
                payload: { configuration },
              })
            if (!saved.success) throw new Error(saved.error)
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const request = indexedDB.open("tako-fs")
              request.onsuccess = () => resolve(request.result)
              request.onerror = () => reject(request.error)
            })
            try {
              const retained = await new Promise<unknown>((resolve, reject) => {
                const request = db
                  .transaction("handles", "readonly")
                  .objectStore("handles")
                  .get("download-root")
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => reject(request.error)
              })
              if (retained === undefined)
                throw new Error("The task lost its captured folder capability")
            } finally {
              db.close()
            }
          },
          { change, command: createCommandEnvelope() }
        )
        releasePlan()

        const task = await waitForTerminalTask(context, taskId)
        assertTaskSucceeded(task)
        await expect
          .poll(
            () =>
              optionsPage.evaluate(
                async (expected) => {
                  const stored =
                    await chrome.storage.local.get("downloadedChapters")
                  return Array.isArray(stored.downloadedChapters)
                    ? stored.downloadedChapters.some(
                        (record: unknown) =>
                          typeof record === "object" &&
                          record !== null &&
                          (
                            record as {
                              siteIntegrationId?: unknown
                              seriesId?: unknown
                              chapterId?: unknown
                            }
                          ).siteIntegrationId === expected.siteIntegrationId &&
                          (
                            record as {
                              seriesId?: unknown
                              chapterId?: unknown
                            }
                          ).seriesId === expected.seriesId &&
                          (record as { chapterId?: unknown }).chapterId ===
                            expected.chapterId
                      )
                    : false
                },
                {
                  siteIntegrationId: "mangadex",
                  seriesId: series.seriesId,
                  chapterId: firstChapter.id,
                }
              ),
            {
              message:
                "the completed chapter should be persisted for Side Panel markers",
              timeout: 5_000,
            }
          )
          .toBe(true)

        let sidepanel = await openSidepanelHarness(context, extensionId, page)
        try {
          await expect(
            sidepanel.getByRole("heading", {
              level: 2,
              name: series.seriesTitle,
            })
          ).toBeVisible()
          await sidepanel
            .getByRole("button", { name: /Select Chapters/i })
            .click()
          const completedRow = sidepanel
            .locator(`[role="checkbox"][id="${firstChapter.id}"]`)
            .locator("..")
          await expect(
            completedRow.locator("[data-downloaded-marker]")
          ).toBeVisible()
          await expect(
            sidepanel.locator("[data-downloaded-marker]")
          ).toHaveCount(1)
        } finally {
          await sidepanel.close()
        }

        // Reopening the extension page rehydrates the persisted projection,
        // covering both live notification and panel-reload behavior.
        sidepanel = await openSidepanelHarness(context, extensionId, page)
        try {
          await sidepanel
            .getByRole("button", { name: /Select Chapters/i })
            .click()
          const rehydratedCompletedRow = sidepanel
            .locator(`[role="checkbox"][id="${firstChapter.id}"]`)
            .locator("..")
          await expect(
            rehydratedCompletedRow.locator("[data-downloaded-marker]")
          ).toBeVisible()
          await expect(
            sidepanel.locator("[data-downloaded-marker]")
          ).toHaveCount(1)
        } finally {
          await sidepanel.close()
        }

        // Direct folder output records its own filesystem result.
        expect(task.lastSuccessfulDownloadId).toBeUndefined()

        const files = await waitForCbzArtifact(optionsPage, seededDirectoryName)
        expect(
          files.some(
            (file) => file.path.toLowerCase().endsWith(".cbz") && file.size > 0
          )
        ).toBe(true)
        await optionsPage.evaluate(async (command) => {
          const cleared = await chrome.runtime.sendMessage({
            target: "background",
            type: "CLEAR_ALL_HISTORY",
            ...command,
            payload: {},
          })
          if (!cleared.success) throw new Error(cleared.error)
        }, createCommandEnvelope())
        await expect
          .poll(() =>
            optionsPage.evaluate(async () => {
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open("tako-fs")
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => reject(request.error)
              })
              try {
                return await new Promise<boolean>((resolve, reject) => {
                  const request = db
                    .transaction("handles", "readonly")
                    .objectStore("handles")
                    .get("download-root")
                  request.onsuccess = () =>
                    resolve(request.result === undefined)
                  request.onerror = () => reject(request.error)
                })
              } finally {
                db.close()
              }
            })
          )
          .toBe(true)
      } finally {
        releasePlan()
        await optionsPage.close()
      }
    })
  }
})
