import { readFile } from "node:fs/promises"
import { unzipSync } from "fflate"
import { MOCK_PLAIN_WEBP_BUFFER } from "../e2e/fixtures/mock-data/site-integrations/mangamillion/image-fixtures"
import { expect, test } from "./extension"

test("reports an interrupted Firefox transfer and retries to the captured path", async ({
  extension,
}) => {
  const filename = "Chapter 01.cbz"
  await extension.setOutput(
    "cbz",
    "Original/<SERIES_TITLE>",
    "Chapter <CHAPTER_NUMBER_PAD2>"
  )
  const release = await extension.holdBrowserTransfer(filename)
  await extension.openSidebar()
  await extension.selectManga()
  await expect.poll(extension.sidebarText).toContain("Romance Dawn")
  await extension.queueFirstChapter("Romance Dawn")
  await expect
    .poll(async () =>
      (await extension.browserDownloads()).some(
        (item) => item.filename === filename && !item.stopped
      )
    )
    .toBe(true)
  await extension.clickSidebar("#panel-tab-recent")
  await expect.poll(extension.sidebarText).toContain("No saved chapters yet.")
  expect(await extension.cancelBrowserTransfer(filename)).toBe(true)
  await release()
  await expect
    .poll(async () =>
      (await extension.browserDownloads()).some(
        (item) =>
          item.filename === filename &&
          item.stopped &&
          item.canceled &&
          !item.succeeded
      )
    )
    .toBe(true)
  await extension.clickSidebar("#panel-tab-queue")
  await expect
    .poll(extension.sidebarText)
    .toMatch(/One Piece[\s\S]*(failed|interrupted)/i)

  await extension.setOutput("zip", "Changed", "New name")
  await extension.clickSidebar(".task-feedback-trigger")
  await extension.clickSidebar('button[aria-label="Restart task"]')

  const expectedPath = `Original/One Piece/${filename}`
  await expect
    .poll(async () =>
      (await extension.browserDownloads())
        .filter((item) => item.succeeded)
        .map((item) => extension.relativeDownloadPath(item.path))
    )
    .toEqual([expectedPath])
  const archive = unzipSync(
    await readFile(`${extension.downloadsDirectory}/${expectedPath}`)
  )
  expect(Buffer.from(archive["1.webp"])).toEqual(MOCK_PLAIN_WEBP_BUFFER)
  expect(Buffer.from(archive["2.webp"])).toEqual(MOCK_PLAIN_WEBP_BUFFER)
  await extension.clickSidebar("#panel-tab-recent")
  await expect
    .poll(extension.sidebarText)
    .toMatch(/One Piece[\s\S]*Romance Dawn[\s\S]*Saved/)
})
