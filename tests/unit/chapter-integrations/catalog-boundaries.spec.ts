import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"
import { Window } from "happy-dom"
import { describe, expect, it } from "vitest"
import { parseMangagoSeries } from "@/src/site-integrations/mangago/series-dom"
import { parseMyComicSeries } from "@/src/site-integrations/mycomic/series-dom"

function catalogDocument(html: string): Document {
  const window = new Window()
  window.document.body.innerHTML = html
  return window.document as unknown as Document
}

const mangagoSeriesUrl = "https://www.mangago.me/read-manga/a_work/"
const mangagoChapter = (route: string, title: string) =>
  `<a class="chico" href="${route}">${title}</a>`

function myComicGroup(
  title: string,
  entries: { id: number; title: string }[]
): string {
  return `<div x-data='${JSON.stringify({ chapters: entries, decending: true })}'><div data-flux-subheading><div>${title}</div></div></div>`
}

describe("Mangago catalog boundaries", () => {
  it("keeps oldest-first chapters and parses independent chapter and volume labels", () => {
    const result = parseMangagoSeries(
      catalogDocument(
        `<h1>A work</h1><div id="chapter_table">${mangagoChapter("an/new/", "Vol. 2 Ch. 3.5")}${mangagoChapter("an/old/", "Prologue")}</div>`
      ),
      mangagoSeriesUrl
    )
    expect(result.chapterList).toMatchObject({
      chapters: [
        {
          id: "an:old",
          title: "Prologue",
          chapterNumber: undefined,
          volumeNumber: undefined,
        },
        {
          id: "an:new",
          chapterLabel: "3.5",
          chapterNumber: 3.5,
          volumeNumber: 2,
        },
      ],
    })
    expect(result.seriesMetadata).toMatchObject({
      title: "A work",
      author: undefined,
      genres: undefined,
      description: undefined,
    })
  })

  it.each([
    [
      "a different series",
      mangagoChapter("/read-manga/other/an/chapter/", "Ch. 1"),
    ],
    ["a missing title", mangagoChapter("an/chapter/", "   ")],
    ["a series link", mangagoChapter("/read-manga/a_work/", "Ch. 1")],
    [
      "duplicate identities",
      mangagoChapter("an/chapter/", "Ch. 1") +
        mangagoChapter("an/chapter/pg-2/", "Ch. 1"),
    ],
  ])("rejects %s", (_reason, links) => {
    expect(() =>
      parseMangagoSeries(
        catalogDocument(
          `<h1>A work</h1><div id="chapter_table">${links}</div>`
        ),
        mangagoSeriesUrl
      )
    ).toThrow(ProviderContractError)
  })

  it("rejects an untrusted cover before consuming the catalog", () => {
    expect(() =>
      parseMangagoSeries(
        catalogDocument(
          `<h1>A work</h1><div class="cover"><img src="https://attacker.example/cover.jpg"></div>`
        ),
        mangagoSeriesUrl
      )
    ).toThrow(ProviderContractError)
  })
})

describe("MyComic catalog groups", () => {
  it("retains custom categories and updates known categories to their source labels", () => {
    const html = `<meta property="og:title" content="A work - MYCOMIC - 我的漫画">${myComicGroup("單話", [{ id: 1, title: "第０２話" }])}${myComicGroup("單行本", [{ id: 2, title: "第３卷" }])}${myComicGroup("特典", [{ id: 3, title: "Special" }])}`
    const result = parseMyComicSeries(
      catalogDocument(html),
      "https://mycomic.com/cn/comics/1"
    )
    expect(result.chapterList).toMatchObject({
      volumes: [
        {
          id: "mycomic:chapters",
          title: "單話",
          label: "單話",
          isCategory: true,
        },
        {
          id: "mycomic:volumes",
          title: "單行本",
          label: "單行本",
          isCategory: true,
        },
        { id: "mycomic:extras", title: "番外篇", isCategory: true },
        { id: "mycomic:特典", title: "特典", label: "特典", isCategory: true },
      ],
      chapters: [
        { id: "1", chapterNumber: 2, volumeNumber: undefined },
        {
          id: "2",
          chapterNumber: undefined,
          volumeNumber: 3,
          chapterLabel: undefined,
        },
        {
          id: "3",
          chapterNumber: undefined,
          volumeId: "mycomic:特典",
          chapterLabel: "Special",
        },
      ],
    })
  })

  it("rejects duplicate identities across groups", () => {
    const html = `<h1 data-flux-heading>A work</h1>${myComicGroup("单话", [{ id: 1, title: "第01话" }])}${myComicGroup("番外篇", [{ id: 1, title: "Extra" }])}`
    expect(() =>
      parseMyComicSeries(
        catalogDocument(html),
        "https://mycomic.com/cn/comics/1"
      )
    ).toThrow(ProviderContractError)
  })

  it("rejects a chapter group whose category is unavailable", () => {
    const html = `<h1 data-flux-heading>A work</h1>${myComicGroup("", [{ id: 1, title: "第01话" }])}`
    expect(() =>
      parseMyComicSeries(
        catalogDocument(html),
        "https://mycomic.com/cn/comics/1"
      )
    ).toThrow(ProviderContractError)
  })
})

describe("MyComic unavailable catalog data", () => {
  it("rejects a catalog whose title cannot be resolved", () => {
    expect(() =>
      parseMyComicSeries(
        catalogDocument(myComicGroup("单话", [{ id: 1, title: "第01话" }])),
        "https://mycomic.com/cn/comics/1"
      )
    ).toThrow(ProviderContractError)
  })

  it("ignores unrelated page state while requiring an available chapter group", () => {
    expect(() =>
      parseMyComicSeries(
        catalogDocument(
          '<h1 data-flux-heading>A work</h1><div x-data="unrelatedState()"></div>'
        ),
        "https://mycomic.com/cn/comics/1"
      )
    ).toThrow(ProviderContractError)
  })
})
