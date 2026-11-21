import { readFile, readdir } from "node:fs/promises"
import { unzipSync } from "fflate"
import { MOCK_PLAIN_WEBP_BUFFER } from "../e2e/fixtures/mock-data/site-integrations/mangamillion/image-fixtures"
import { expect, test } from "./extension"

test("saves a complete ZIP using the naming defaults captured before Options changed", async ({
  extension,
}) => {
  await extension.setOutput(
    "zip",
    "ZIP Library/<SERIES_TITLE>",
    "Chapter <CHAPTER_NUMBER_PAD2>"
  )
  await extension.openSidebar()
  await extension.selectManga()
  await expect.poll(extension.sidebarText).toContain("Romance Dawn")

  const release = extension.fixture.holdPages()
  await extension.queueFirstChapter("Romance Dawn")
  await expect.poll(() => extension.fixture.pageRequests).toBeGreaterThan(0)
  await extension.setOutput("none", "Changed", "New name")
  release()

  const output = "ZIP Library/One Piece/Chapter 01.zip"
  await expect
    .poll(async () =>
      (await extension.browserDownloads())
        .filter((item) => item.succeeded)
        .map((item) => extension.relativeDownloadPath(item.path))
    )
    .toEqual([output])
  const archive = unzipSync(
    await readFile(`${extension.downloadsDirectory}/${output}`)
  )
  for (const filename of ["1.webp", "2.webp"]) {
    expect(Buffer.from(archive[filename])).toEqual(MOCK_PLAIN_WEBP_BUFFER)
  }
  expect(archive["ComicInfo.xml"]).toBeDefined()
})

test("records individual images as saved after the last Firefox transfer finishes", async ({
  extension,
}) => {
  await extension.setOutput(
    "none",
    "Images/<SERIES_TITLE>",
    "Chapter <CHAPTER_NUMBER_PAD2>"
  )
  const release = await extension.holdBrowserTransfer("2.webp")
  await extension.openSidebar()
  await extension.selectManga()
  await expect.poll(extension.sidebarText).toContain("Romance Dawn")
  await extension.queueFirstChapter("Romance Dawn")

  await expect
    .poll(async () =>
      (await extension.browserDownloads()).some(
        (item) => item.filename === "1.webp" && item.succeeded
      )
    )
    .toBe(true)
  await expect
    .poll(async () =>
      (await extension.browserDownloads()).some(
        (item) => item.filename === "2.webp" && !item.stopped
      )
    )
    .toBe(true)
  await extension.clickSidebar("#panel-tab-recent")
  await expect.poll(extension.sidebarText).toContain("No saved chapters yet.")

  await release()
  await expect
    .poll(async () =>
      (await extension.browserDownloads())
        .filter((item) => item.succeeded && /^[12]\.webp$/.test(item.filename))
        .map((item) => extension.relativeDownloadPath(item.path))
        .sort()
    )
    .toEqual([
      "Images/One Piece/Chapter 01/1.webp",
      "Images/One Piece/Chapter 01/2.webp",
    ])
  await expect
    .poll(extension.sidebarText)
    .toMatch(/One Piece[\s\S]*Romance Dawn[\s\S]*Saved/)
  const chapterDirectory = `${extension.downloadsDirectory}/Images/One Piece/Chapter 01`
  expect((await readdir(chapterDirectory)).sort()).toEqual([
    "000-cover.webp",
    "1.webp",
    "2.webp",
    "ComicInfo.xml",
  ])
  for (const filename of ["1.webp", "2.webp"]) {
    expect(await readFile(`${chapterDirectory}/${filename}`)).toEqual(
      MOCK_PLAIN_WEBP_BUFFER
    )
  }
})
