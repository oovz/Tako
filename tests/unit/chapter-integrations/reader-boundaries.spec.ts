import { readFileSync } from "node:fs"
import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"
import { Window } from "happy-dom"
import { describe, expect, it } from "vitest"
import { MAX_CHAPTER_IMAGES } from "@/src/constants/timeouts"
import {
  parseMangagoProtocol,
  parseMangagoReader,
  withMangagoGrid,
} from "@/src/site-integrations/mangago/reader"
import contract from "@/tests/fixtures/site-integrations/mangago/contract.json"

const readerHtml = readFileSync(
  "tests/fixtures/site-integrations/mangago/reader.html",
  "utf8"
)
function documentFor(html: string): Document {
  const window = new Window()
  window.document.body.innerHTML = html
  return window.document as unknown as Document
}
function protocolScript(source: string): string {
  return `sojson.v4; null,"${Array.from(source, (char) => char.charCodeAt(0)).join("a")}"[0]`
}
const source =
  'var key=CryptoJS.enc.Hex.parse("00000000000000000000000000000000");var iv=CryptoJS.enc.Hex.parse("11111111111111111111111111111111");widthnum=heightnum=2;str.charAt(1);str.charAt(2);str.charAt(3);str.charAt(4);var renImg;var key="0a1a2a3";'

describe("Mangago reader boundaries", () => {
  it.each([
    [
      "zero pages",
      readerHtml.replace(/total_pages\s*=\s*\d+/, "total_pages=0"),
    ],
    [
      "too many pages",
      readerHtml.replace(
        /total_pages\s*=\s*\d+/,
        `total_pages=${MAX_CHAPTER_IMAGES + 1}`
      ),
    ],
    [
      "page outside the chapter",
      readerHtml.replace(/current_page\s*=\s*\d+/, "current_page=99999"),
    ],
    [
      "a changed chapter template",
      readerHtml.replace(
        /id="curl" value="[^"]+"/,
        'id="curl" value="/an/other/pg-{page}/"'
      ),
    ],
    [
      "an untrusted script",
      readerHtml.replaceAll("pic1.mangapicgallery.com", "attacker.example"),
    ],
  ])("rejects %s", (_reason, html) => {
    expect(() =>
      parseMangagoReader(documentFor(html), contract.data.readerUrl)
    ).toThrow(ProviderContractError)
  })

  it("retains identity when constructing later reader pages", () => {
    const reader = parseMangagoReader(
      documentFor(readerHtml),
      contract.data.readerUrl
    )
    expect(reader.pageUrl(2)).toBe(
      contract.data.readerUrl.replace("pg-1", "pg-2")
    )
  })

  it.each([
    ["an absent encryption key", source.replace(/var key=CryptoJS[^;]+;/, "")],
    [
      "an absent initialization vector",
      source.replace(/var iv=CryptoJS[^;]+;/, ""),
    ],
    ["an oversized grid", source.replace("heightnum=2", "heightnum=17")],
    ["an incomplete order key", source.replace("str.charAt(4);", "")],
    ["duplicate tile destinations", source.replace("0a1a2a3", "0a0a2a3")],
  ])("rejects %s in protocol data", (_reason, decoded) => {
    expect(() => parseMangagoProtocol(protocolScript(decoded))).toThrow(
      ProviderContractError
    )
  })

  it("attaches the last matching signature mapping while leaving direct images unchanged", () => {
    const protocol = parseMangagoProtocol(protocolScript(source))
    protocol.grids.set("chapter", [1, 0, 3, 2])
    protocol.grids.set("page", [2, 3, 0, 1])
    const scrambled =
      "https://iweb_9.mangapicgallery.com/r/cspiclink/chapter/page.jpg"
    expect(withMangagoGrid(scrambled, protocol)).toBe(
      `${scrambled}#mg-grid=2:2,3,0,1`
    )
    const direct =
      "https://iweb_9.mangapicgallery.com/r/newpiclink/chapter/page.jpg"
    expect(withMangagoGrid(direct, protocol)).toBe(direct)
  })
})

describe("Mangago ordered special grids", () => {
  it("restores inserted order digits before interpreting the tile permutation", () => {
    const first = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    const second = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    const layout = source.replace(
      /charAt\((\d)\)/g,
      (_, position: string) => `charAt(${Number(position) - 1})`
    )
    const special = `if(img.src.indexOf("${first}")>0||img.src.indexOf("${second}")>0){var _0X2c9a16=img.src.indexOf("${first}")>0?"1000a0a1a23":"1000a3a2a10"}`
    const protocol = parseMangagoProtocol(protocolScript(layout + special))
    expect(protocol.grids.get(first)).toEqual([0, 1, 2, 3])
    expect(protocol.grids.get(second)).toEqual([3, 2, 1, 0])
  })
})
