import { zipSync } from "fflate"
import { readFile } from "node:fs/promises"
import { test, expect } from "./fixtures/extension"
import { inspectChapterArchive } from "./fixtures/chapter-artifact"
import { SMALL_PNG_BYTES } from "./fixtures/mock-data/shared/pixel-png"
import { SHONEN_JUMP_PLUS_SCRAMBLED_PNG } from "./fixtures/mock-data/site-integrations/shonenjumpplus/scrambled-image-fixture"
import { expectSavedChapterArchive } from "../live/fixtures/download-workflow-helpers"
import { createTaskSettingsSnapshot } from "../../src/runtime/settings-snapshot"
import { DEFAULT_SETTINGS } from "../../src/domain/settings/defaults"

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

test("retains the complete saved chapter and inspection receipt for visual review", async ({
  page,
}, testInfo) => {
  const bytes = zipSync({ "001.png": SHONEN_JUMP_PLUS_SCRAMBLED_PNG })
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
        "shonenjumpplus"
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
    images: [{ name: "001.png", width: 32, height: 32 }],
  })
})
