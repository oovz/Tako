import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import {
  decodeCopyPayload,
  parseCopyChapterCatalog,
  parseCopyReader,
  parseCopyUrl,
  normalizeCopyImageUrl,
  readCopyKey,
} from "@/src/site-integrations/copymanga/api"
import contractFixture from "@/tests/fixtures/site-integrations/copymanga/contract.json"
import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"

const fixture = contractFixture.data

describe("CopyManga reader", () => {
  it("rejects empty catalogs", () => {
    expect(() =>
      parseCopyChapterCatalog(
        {
          build: {
            path_word: "dianjuren",
            type: [
              { id: 1, name: "話" },
              { id: 2, name: "卷" },
              { id: 3, name: "番外篇" },
            ],
          },
          groups: { default: { name: "默認", count: 0, chapters: [] } },
        },
        new URL("https://www.copy4000.com/comic/dianjuren")
      )
    ).toThrow(ProviderContractError)
  })
  it("decodes the working Chainsaw Man reader using its observed CDN", async () => {
    const images = await parseCopyReader(
      readFileSync(
        "tests/fixtures/site-integrations/copymanga/reader-dianjuren.html",
        "utf8"
      )
    )
    expect(images).toHaveLength(53)
    expect(images[0]).toContain("/d/dianjuren/0f432/1647500603070001.jpg")
    expect(new URL(images[0]).origin).toBe("https://sd.mangafunb.fun")
  })

  it("rejects undeclared image origins and credentials", () => {
    for (const url of [
      "https://sd.mangafunb.fun.evil.example/page.jpg",
      "http://sd.mangafunb.fun/page.jpg",
      "https://user:password@sd.mangafunb.fun/page.jpg",
    ])
      expect(() => normalizeCopyImageUrl(url)).toThrow()
  })
  it("decodes the captured catalog without executing site JavaScript", async () => {
    const decoded = await decodeCopyPayload(
      fixture.catalog.results,
      fixture.key
    )
    const first = parseCopyChapterCatalog(
      decoded,
      new URL("https://www.copy3000.com/comic/yiquanchaoren")
    )
    const second = parseCopyChapterCatalog(
      decoded,
      new URL("https://www.copy4000.com/comic/yiquanchaoren")
    )
    const volume = first.chapters.find(
      (chapter) => chapter.id === "2c814b6a-4f03-11e9-8b1c-024352452ce0"
    )
    expect(volume).toMatchObject({
      id: "2c814b6a-4f03-11e9-8b1c-024352452ce0",
      title: "第01卷",
      volumeNumber: 1,
      volumeId: "copy:default:2",
    })
    expect(volume?.chapterNumber).toBeUndefined()
    expect(first.chapters.map((ch) => ch.id)).toEqual(
      second.chapters.map((ch) => ch.id)
    )
    expect(new Set(first.chapters.map((ch) => ch.id)).size).toBe(490)
    expect(first.volumes).toEqual([
      { id: "copy:default:1", title: "默認 · 話", label: "默認 · 話" },
      { id: "copy:default:2", title: "默認 · 卷", label: "默認 · 卷" },
      { id: "copy:default:3", title: "默認 · 番外篇", label: "默認 · 番外篇" },
      {
        id: "copy:other_group:1",
        title: "其他系列 · 話",
        label: "其他系列 · 話",
      },
      {
        id: "copy:other_group:2",
        title: "其他系列 · 卷",
        label: "其他系列 · 卷",
      },
      {
        id: "copy:other_group:3",
        title: "其他系列 · 番外篇",
        label: "其他系列 · 番外篇",
      },
    ])
    expect(
      first.chapters.some((ch) => ch.volumeId === "copy:other_group:2")
    ).toBe(false)
    expect(
      first.chapters.some((ch) => ch.volumeId === "copy:other_group:3")
    ).toBe(false)
  })

  it("preserves every captured Chainsaw Man edition and its empty categories", async () => {
    const html = readFileSync(
      "tests/fixtures/site-integrations/copymanga/series.html",
      "utf8"
    )
    const catalog = JSON.parse(
      readFileSync(
        "tests/fixtures/site-integrations/copymanga/catalog-dianjuren.json",
        "utf8"
      )
    )
    const result = parseCopyChapterCatalog(
      await decodeCopyPayload(catalog.results, readCopyKey(html, "ccz")),
      new URL("https://www.copy3000.com/comic/dianjuren")
    )
    expect(result.chapters).toHaveLength(320)
    expect(new Set(result.chapters.map((chapter) => chapter.id)).size).toBe(320)
    expect(result.volumes).toHaveLength(9)
    expect(
      result.volumes.map(
        (volume) =>
          result.chapters.filter((chapter) => chapter.volumeId === volume.id)
            .length
      )
    ).toEqual([233, 11, 14, 0, 22, 0, 29, 11, 0])
    expect(
      result.chapters.find(
        (chapter) => chapter.id === "dc312a94-f526-11e8-a7d3-00163e0ca5bd"
      )
    ).toMatchObject({
      chapterLabel: "第01话",
      chapterNumber: 1,
      volumeId: "copy:default:1",
    })
    expect(
      result.chapters.find(
        (chapter) => chapter.id === "820f938e-16fb-11ed-9b6e-024352452ce0"
      )
    ).toMatchObject({ title: "第12話[全彩]", blackAndWhite: "No" })
    expect(
      result.chapters.find(
        (chapter) => chapter.id === "dc312a94-f526-11e8-a7d3-00163e0ca5bd"
      )?.blackAndWhite
    ).toBeUndefined()
    const sameVolume = result.chapters.filter(
      (chapter) => chapter.volumeNumber === 1
    )
    expect(sameVolume).toHaveLength(3)
    expect(new Set(sameVolume.map((chapter) => chapter.id)).size).toBe(3)
    const appendix = result.chapters.find(
      (chapter) => chapter.title === "01卷附录"
    )
    expect(appendix).toMatchObject({ volumeId: "copy:default:3" })
    expect(appendix?.volumeNumber).toBeUndefined()
    expect(appendix?.chapterNumber).toBeUndefined()
  })

  it("uses the encrypted content list and preserves its meaningful order", async () => {
    const images = await parseCopyReader(
      `<script>var cct = '${fixture.key}'; var contentKey = '${fixture.readerPayload}';</script><img src='https://ads.example/ad.jpg'>`
    )
    expect(images).toHaveLength(14)
    expect(images[0]).toContain("1791435778960012.jpg")
    expect(images[1]).toContain("1791435779830002.jpg")
  })

  it("rejects pre-hydration emptiness, malformed encryption and external origins", async () => {
    await expect(
      parseCopyReader("<ul class='comicContent-list'></ul>")
    ).rejects.toThrow()
    await expect(
      decodeCopyPayload("not encrypted", fixture.key)
    ).rejects.toThrow()
    expect(() =>
      parseCopyUrl("https://attacker.example/comic/yiquanchaoren")
    ).toThrow()
  })
})
