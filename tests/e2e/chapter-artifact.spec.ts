import { zipSync } from "fflate"
import { readFile } from "node:fs/promises"
import { test, expect } from "./fixtures/extension"
import {
  inspectChapterArchive,
  inspectComicInfo,
} from "./fixtures/chapter-artifact"
import { SMALL_PNG_BYTES } from "./fixtures/mock-data/shared/pixel-png"
import { SHONEN_JUMP_PLUS_SCRAMBLED_PNG } from "./fixtures/mock-data/site-integrations/shonenjumpplus/scrambled-image-fixture"
import { expectSavedChapterArchive } from "../live/fixtures/download-workflow-helpers"
import { createTaskSettingsSnapshot } from "../../src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "../../src/domain/settings/defaults"
import { assertLiveSeriesMetadata } from "../live/fixtures/series-metadata-helpers"

test("saved archive checker decodes real images and rejects corrupt page content", async ({
  page,
}) => {
  const images = await inspectChapterArchive(
    page,
    zipSync({ "001.png": SMALL_PNG_BYTES }),
    1
  )
  expect(images).toMatchObject([{ name: "001.png", width: 1, height: 1 }])
  expect(images[0].preview).toMatch(/^data:image\/png;base64,/)

  const fourPages = {
    "001.png": SMALL_PNG_BYTES,
    "002.png": SMALL_PNG_BYTES,
    "003.png": SMALL_PNG_BYTES,
    "004.png": SMALL_PNG_BYTES,
  }
  const inspected = await inspectChapterArchive(page, zipSync(fourPages), 4)
  expect(inspected).toHaveLength(4)
  expect(inspected[3]).toEqual({ name: "004.png", width: 1, height: 1 })

  for (const badImage of [
    new TextEncoder().encode("<html>Access denied</html>"),
    SMALL_PNG_BYTES.subarray(0, 33),
  ]) {
    await expect(
      inspectChapterArchive(
        page,
        zipSync({ ...fourPages, "004.png": badImage }),
        4
      )
    ).rejects.toThrow()
  }
})

test("retains saved chapter files and image inspection results", async ({
  page,
}, testInfo) => {
  const bytes = zipSync({
    "001.png": SHONEN_JUMP_PLUS_SCRAMBLED_PNG,
    "ComicInfo.xml": new TextEncoder().encode(
      "<ComicInfo><Series>Artifact fixture</Series><Title>Chapter 1</Title><Writer>Author &amp; Artist</Writer><Summary>A full synopsis.</Summary><Genre>Adventure, Fantasy</Genre><Web>https://example.test/chapter/1</Web><PageCount>1</PageCount></ComicInfo>"
    ),
  })
  await expectSavedChapterArchive(
    page,
    bytes,
    {
      id: "artifact-task",
      siteIntegrationId: "shonenjumpplus",
      mangaId: "artifact-series",
      seriesTitle: "Artifact fixture",
      status: "completed",
      created: 1,
      settingsSnapshot: createTaskSettingsSnapshot(
        DEFAULT_SETTINGS,
        "shonenjumpplus",
        {
          comicInfo: {
            author: "Author & Artist",
            description: "A full synopsis.",
            genres: ["Adventure", "Fantasy"],
          },
        }
      ),
      chapters: [
        {
          requestedPath: "Tako/Chapter.cbz",
          id: "artifact-chapter",
          title: "Chapter 1",
          url: "https://example.test/chapter/1",
          index: 1,
          status: "completed",
          totalImages: 1,
          lastUpdated: 1,
        },
      ],
    },
    "https://example.test/work/1",
    testInfo
  )

  const archive = testInfo.attachments.find(
    ({ name }) => name === "saved-chapter.cbz"
  )
  expect(await readFile(archive!.path!)).toEqual(Buffer.from(bytes))
  const receipt = testInfo.attachments.find(
    ({ name }) => name === "chapter-artifact-inspection.json"
  )
  expect(JSON.parse(await readFile(receipt!.path!, "utf8"))).toMatchObject({
    takoVersion: expect.any(String),
    inspectedAt: expect.any(String),
    browser: expect.any(String),
    workUrl: "https://example.test/work/1",
    chapter: { id: "artifact-chapter" },
    comicInfo: {
      Writer: "Author & Artist",
      Summary: "A full synopsis.",
      Genre: "Adventure, Fantasy",
      PageCount: "1",
    },
    images: [{ name: "001.png", width: 32, height: 32 }],
  })
})

test("ComicInfo inspection parses escaped text and rejects malformed metadata", async ({
  page,
}) => {
  expect(
    await inspectComicInfo(
      page,
      "<ComicInfo><Writer>A &amp; B</Writer><Summary>作品</Summary></ComicInfo>"
    )
  ).toEqual({ Writer: "A & B", Summary: "作品" })
  for (const xml of [
    "<ComicInfo>",
    "<html/>",
    "<ComicInfo><Writer>A</Writer><Writer>B</Writer></ComicInfo>",
  ]) {
    await expect(inspectComicInfo(page, xml)).rejects.toThrow()
  }
})

test("live metadata checks require a real synopsis source and matching extracted text", async ({
  page,
}, testInfo) => {
  const credits =
    '<div class="banner_detail_form"><p class="subtitle"><a>Author</a></p><p class="tip"><a>Adventure</a></p>'
  const state = {
    siteIntegrationId: "animemangahouse",
    mangaId: "1",
    seriesTitle: "A work",
    chapters: [],
    metadata: {
      language: "zh",
      author: "Author",
      genres: ["Adventure"],
      description: "A full synopsis.",
    },
  }
  await page.setContent(`${credits}</div>`)
  await expect(
    assertLiveSeriesMetadata(page, state, testInfo)
  ).rejects.toThrow()
  await page.setContent(
    `${credits}<p class="content">A full synopsis.</p></div>`
  )
  await assertLiveSeriesMetadata(page, state, testInfo)
  await expect(
    assertLiveSeriesMetadata(
      page,
      {
        ...state,
        metadata: { ...state.metadata, description: "An incorrect synopsis." },
      },
      testInfo
    )
  ).rejects.toThrow()
})

test("live synopsis comparison excludes Mangago's browser-added expansion control", async ({
  page,
}, testInfo) => {
  await page.setContent(
    '<h1>A work</h1><div class="manga_right"><table><tr><td><label>Author:</label><a>Author</a>1998 released.</td></tr><tr><td><a href="/genre/Adventure/">Adventure</a></td></tr></table></div><div class="manga_summary">A full synopsis.<div class="transform comment_rname expand" title="Expand">+</div></div>'
  )
  await assertLiveSeriesMetadata(
    page,
    {
      siteIntegrationId: "mangago",
      mangaId: "a-work",
      seriesTitle: "A work",
      chapters: [],
      metadata: {
        language: "en",
        author: "Author",
        genres: ["Adventure"],
        year: 1998,
        description: "A full synopsis.",
      },
    },
    testInfo
  )
})
