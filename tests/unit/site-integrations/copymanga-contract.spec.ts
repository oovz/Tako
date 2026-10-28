import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import {
  decodeCopyPayload,
  parseCopyChapterCatalog,
  parseCopyReader,
  parseCopyUrl,
  normalizeCopyImageUrl,
} from "@/src/site-integrations/copymanga/api"
import contractFixture from "@/tests/fixtures/site-integrations/copymanga/contract.json"
import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"

const fixture = contractFixture.data

describe("Copy public reader contract", () => {
  it("rejects an empty catalog instead of reporting a successfully loaded series", () => {
    expect(() =>
      parseCopyChapterCatalog(
        {
          build: { path_word: "dianjuren" },
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
    expect(first[0]).toMatchObject({
      id: "2c814b6a-4f03-11e9-8b1c-024352452ce0",
      title: "第01卷",
    })
    expect(first.map((ch) => ch.id)).toEqual(second.map((ch) => ch.id))
    expect(new Set(first.map((ch) => ch.id)).size).toBe(first.length)
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
