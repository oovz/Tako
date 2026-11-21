import { readFile } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"
import { unzipSync } from "fflate"
import { MOCK_PLAIN_WEBP_BUFFER } from "../e2e/fixtures/mock-data/site-integrations/mangamillion/image-fixtures"
import { expect, test } from "./extension"
import { mangaMillionSeries } from "./mangamillion-fixture"

async function inspectChapterArchive(path: string) {
  const archive = unzipSync(await readFile(path))
  const pages = Object.keys(archive)
    .filter((name) => /^\d+\.webp$/.test(name))
    .sort()
  expect(pages).toEqual(["1.webp", "2.webp", "3.webp"])
  for (const page of pages)
    expect(Buffer.from(archive[page])).toEqual(MOCK_PLAIN_WEBP_BUFFER)
  expect(archive["ComicInfo.xml"]).toBeDefined()
}

test("saves and records a CBZ after the sidebar closes while work is in progress", async ({
  extension,
}) => {
  await extension.openSidebar()
  await extension.selectManga()
  await expect.poll(extension.sidebarText).toContain("One Piece")
  const releasePages = extension.fixture.holdPages()
  await extension.queueFirstChapter("Romance Dawn")
  await expect
    .poll(() => extension.fixture.pageRequests)
    .toBeGreaterThanOrEqual(1)
  await extension.closeSidebar()
  const secondSeries = new URL("10", mangaMillionSeries).href
  await extension.navigate(secondSeries, "default")

  // Wait beyond Firefox's 30-second idle timeout while the fixture holds the
  // image requests. The test continues through the normal retry on fetch timeout.
  await delay(32_000)
  expect(await extension.browserDownloads()).toEqual([])
  releasePages()
  await expect
    .poll(
      async () =>
        (await extension.browserDownloads()).some((item) => item.succeeded),
      { timeout: 25_000 }
    )
    .toBe(true)
  const [saved] = await extension.browserDownloads()
  expect(extension.relativeDownloadPath(saved.path)).toMatch(
    /^TMD\/One Piece\/.*Romance Dawn\.cbz$/
  )
  await inspectChapterArchive(saved.path)
  expect(
    await extension.firefox.execute(
      "return [...gBrowser.browsers].map(tab => tab.currentURI.spec)"
    )
  ).toEqual([mangaMillionSeries, secondSeries])

  await extension.openSidebar()
  await extension.selectManga()
  await expect.poll(extension.sidebarText).toContain("Dandadan")
  await extension.clickSidebar("#panel-tab-recent")
  await expect
    .poll(extension.sidebarText)
    .toMatch(/One Piece[\s\S]*Romance Dawn[\s\S]*Saved/)
})
