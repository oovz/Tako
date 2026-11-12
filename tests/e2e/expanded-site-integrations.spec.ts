import { test, expect } from "./fixtures/extension"
import { readFile } from "node:fs/promises"
import {
  inspectChapterImages,
  readChapterArchiveWithComicInfo,
} from "./fixtures/chapter-artifact"
import { expectSavedChapterArchive } from "../live/fixtures/download-workflow-helpers"
import { assertLiveSeriesMetadata } from "../live/fixtures/series-metadata-helpers"
import {
  getTabId,
  openMangaSidepanelHarness,
  waitForGlobalState,
  waitForTabSeriesTitle,
  waitForTabStateById,
} from "./fixtures/state-helpers"
import {
  assertTaskSucceeded,
  openOptionsPage,
  persistDownloadSettings,
  waitForBrowserDownloadArtifact,
  waitForTerminalTask,
} from "./fixtures/download-workflow-helpers"
import {
  retainExtensionSessionRules,
  setIntegrationEnabledFromWorker,
  testExtensionSessionRuleMatch,
} from "./fixtures/session-rule-helpers"
import { manganatoFixture } from "./fixtures/mock-data/site-integrations/manganato/routes"
import { mangakakalotFixture } from "./fixtures/mock-data/site-integrations/mangakakalot/routes"
import { boyloveFixture } from "./fixtures/mock-data/site-integrations/boylove/routes"
import { copyFixture } from "./fixtures/mock-data/site-integrations/copymanga/routes"
import { mycomicFixture } from "./fixtures/mock-data/site-integrations/mycomic/routes"
import { dm5Fixture } from "./fixtures/mock-data/site-integrations/animemangahouse/routes"
import { mangabzFixture } from "./fixtures/mock-data/site-integrations/mangabz/routes"
import { zaimanhuaFixture } from "./fixtures/mock-data/site-integrations/mangaagain/routes"
import { aimanhuaFixture } from "./fixtures/mock-data/site-integrations/lovemanga/routes"
import { mangahereFixture } from "./fixtures/mock-data/site-integrations/mangahere/routes"
import { mangagoFixture } from "./fixtures/mock-data/site-integrations/mangago/routes"
import { coolmicFixture } from "./fixtures/mock-data/site-integrations/coolmic/routes"
import { mangaplusFixture } from "./fixtures/mock-data/site-integrations/mangaplus/routes"
import type { RuntimeMessageResponse } from "../../src/runtime/runtime-message-contracts"

const fixtures = [
  manganatoFixture,
  mangakakalotFixture,
  boyloveFixture,
  copyFixture,
  mycomicFixture,
  dm5Fixture,
  mangabzFixture,
  zaimanhuaFixture,
  aimanhuaFixture,
  mangahereFixture,
  mangagoFixture,
  coolmicFixture,
  mangaplusFixture,
]

test.describe("site downloads through the chapter selector", () => {
  test.describe.configure({ timeout: 120_000 })

  for (const { testCase: fixture } of fixtures) {
    for (const seriesUrl of [fixture.seriesUrl, ...(fixture.aliases ?? [])]) {
      test(`${fixture.id} selects and saves a chapter on ${new URL(seriesUrl).hostname}`, async ({
        context,
        extensionId,
        page,
      }, testInfo) => {
        await page.goto(seriesUrl, { waitUntil: "domcontentloaded" })
        const tabId = await getTabId(page, context)
        await waitForTabSeriesTitle(context, tabId, fixture.title)
        const state = await waitForTabStateById(
          page,
          context,
          tabId,
          (candidate) =>
            candidate.chapters.some(
              (chapter) => chapter.id === fixture.chapterId
            )
        )
        expect(state.siteIntegrationId).toBe(fixture.id)
        expect(state.mangaId).toBe(fixture.seriesId)
        await assertLiveSeriesMetadata(page, state, testInfo)
        const chapter = state.chapters.find(
          (candidate) => candidate.id === fixture.chapterId
        )!
        expect(chapter.locked).not.toBe(true)

        const optionsPage = await openOptionsPage(context, extensionId)
        await persistDownloadSettings(optionsPage, {
          destination: "downloads-api",
          customDirectoryHandleId: null,
          defaultFormat: "cbz",
          conflictPolicy: "overwrite",
          includeCoverImage: false,
          includeComicInfo: true,
          normalizeImageFilenames: true,
          imagePaddingDigits: 3,
        })
        const panel = await openMangaSidepanelHarness(
          context,
          extensionId,
          page
        )
        try {
          await expect(
            panel.getByText(fixture.title, { exact: true }).first()
          ).toBeVisible()
          await panel.getByRole("tab", { name: "Manga", exact: true }).click()
          if (fixture.id === "copymanga" || fixture.id === "mycomic") {
            expect(state.volumes.length).toBeGreaterThanOrEqual(3)
            // Collapse mounted groups in order so later virtualized headers appear.
            for (const volume of state.volumes) {
              const row = panel.locator('[data-kind="volume"]').filter({
                has: panel.getByText(volume.title!, { exact: true }),
              })
              const toggle = row.getByRole("button")
              await expect(toggle).toBeVisible()
              await expect(row.locator(".volume-copy strong")).toHaveText(
                volume.title!
              )
              const firstChapters = state.chapters
                .filter((item) => item.volumeId === volume.id)
                .slice(0, 2)
              if (firstChapters.length > 0) {
                if ((await toggle.getAttribute("aria-expanded")) === "false") {
                  await toggle.click()
                }
                for (const [index, entry] of firstChapters.entries()) {
                  const chapterRow = panel.locator(".manga-chapter").filter({
                    has: panel.locator(`[id="${entry.id}"]`),
                  })
                  await expect(
                    chapterRow.locator(".chapter-number")
                  ).toHaveText(String(index + 1))
                }
                await toggle.click()
                await expect(toggle).toHaveAttribute("aria-expanded", "false")
              } else {
                await expect(toggle).toBeDisabled()
                await expect(row.getByRole("checkbox")).toBeDisabled()
              }
            }
          }
          const allChapters = panel.getByRole("radio", {
            name: /Chapters/i,
          })
          if (await allChapters.count()) await allChapters.click()
          const selector = panel.locator("[data-virtualized]")
          const chapterIndex = state.chapters.findIndex(
            (item) => item.id === fixture.chapterId
          )
          await selector.evaluate((element, index) => {
            element.scrollTop = index * 40
          }, chapterIndex)
          const selection = panel.locator(
            `[role="checkbox"][id="${fixture.chapterId}"]`
          )
          await selection.check()
          await panel.getByRole("button", { name: /Download \(1\)/i }).click()
          const queued = await waitForGlobalState(context, (candidate) =>
            candidate.downloadQueue.some(
              (task) =>
                task.siteIntegrationId === fixture.id &&
                task.chapters.some((item) => item.id === fixture.chapterId)
            )
          )
          const id = queued.downloadQueue.find(
            (task) => task.siteIntegrationId === fixture.id
          )!.id
          const task = await waitForTerminalTask(context, id)
          assertTaskSucceeded(task)
          expect(task.chapters[0]).toMatchObject({
            id: fixture.chapterId,
            totalImages: fixture.pageCount,
            outputDestination: "downloads-api",
            saveConfirmedAt: expect.any(Number),
            outputs: { requested: 1, committed: 1, failed: 0 },
          })
          expect(task.lastSuccessfulDownloadId).toEqual(expect.any(Number))
          const output = await waitForBrowserDownloadArtifact(
            optionsPage,
            task.lastSuccessfulDownloadId!
          )
          expect(output.state).toBe("complete")
          expect(output.fileSize).toBeGreaterThan(0)
          const archiveBytes = await readFile(output.filename)
          await expectSavedChapterArchive(
            optionsPage,
            archiveBytes,
            task,
            seriesUrl,
            testInfo
          )
          if (fixture.id === "coolmic") {
            const images = await inspectChapterImages(
              optionsPage,
              readChapterArchiveWithComicInfo(archiveBytes, fixture.pageCount)
                .images
            )
            expect(
              images.map(({ width, height }) => ({ width, height }))
            ).toEqual(
              Array.from({ length: fixture.pageCount }, () => ({
                width: 26,
                height: 2,
              }))
            )
          }
          await expect
            .poll(async () =>
              panel.evaluate(async () => {
                const response: RuntimeMessageResponse<"GET_SIDEPANEL_DOWNLOAD_STATE"> =
                  await chrome.runtime.sendMessage({
                    target: "background",
                    type: "GET_SIDEPANEL_DOWNLOAD_STATE",
                  })
                if (!response.success) throw new Error(response.error)
                return response.data.downloadedChapters
              })
            )
            .toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  siteIntegrationId: fixture.id,
                  seriesId: fixture.seriesId,
                  chapterId: fixture.chapterId,
                  outputDestination: "downloads-api",
                  saveConfirmedAt: expect.any(Number),
                }),
              ])
            )
        } finally {
          await panel.close()
          await optionsPage.close()
        }
      })
    }
  }
})

const refererCases = [
  {
    id: "manganato",
    rule: 41011,
    url: "https://img-manganato.2xstorage.com/manganato/1.png",
  },
  {
    id: "mangakakalot",
    rule: 41012,
    url: "https://img-mangakakalove.2xstorage.com/mangakakalove/1.png",
  },
  {
    id: "animemangahouse",
    rule: 41120,
    url: "https://manhua1032zjcdn26.cdndm5.com/browser/1.png",
  },
  {
    id: "mangabz",
    rule: 41121,
    url: "https://image.mangabz.com/browser/1.png",
  },
  {
    id: "mycomic",
    rule: 41015,
    url: "https://biccam.com/chapters/492177/1-fixture.png",
  },
]

for (const item of refererCases) {
  test(`${item.id} reader referer rule follows integration enablement`, async ({
    context,
    extensionId,
  }) => {
    await retainExtensionSessionRules(context, extensionId, [item.rule])
    const request = {
      initiator: `chrome-extension://${extensionId}/`,
      type: "xmlhttprequest" as const,
      url: item.url,
    }
    await expect
      .poll(() => testExtensionSessionRuleMatch(context, extensionId, request))
      .toContain(item.rule)
    await expect(
      testExtensionSessionRuleMatch(context, extensionId, {
        ...request,
        initiator: "https://example.com/",
      })
    ).resolves.not.toContain(item.rule)
    await setIntegrationEnabledFromWorker(context, extensionId, item.id, false)
    await expect
      .poll(() => testExtensionSessionRuleMatch(context, extensionId, request))
      .not.toContain(item.rule)
  })
}
