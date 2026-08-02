import { describe, expect, it } from "vitest"
import {
  captureBrowserGlobals,
  compressToBase64,
  makeHtmlResponse,
  mockRateLimitedFetch,
  restoreBrowserGlobals,
  setTestDocument,
  setTestWindow,
} from "./manhuagui-test-setup"
import {
  extractChapterListFromDocument,
  extractSeriesMetadataFromDocument,
} from "@/src/site-integrations/manhuagui/series-dom"
import { parseSeriesIdFromPath } from "@/src/site-integrations/manhuagui/shared"

type MockChapterGroup = {
  groupTitle: string
  links: Array<Record<string, unknown>>
  beforeList?: Array<Record<string, unknown>>
}

function buildMockChapterContainer(chapterGroups: MockChapterGroup[]) {
  const children = chapterGroups.flatMap((group) => [
    { tagName: "H4", textContent: group.groupTitle },
    ...(group.beforeList ?? []),
    {
      tagName: "DIV",
      className: "chapter-list cf mt10",
      querySelectorAll: (selector: string) =>
        selector === "li > a, a" ? group.links : [],
    },
  ])

  return { children }
}

function queryChapterContainers(selector: string, chapterContainer: unknown) {
  if (selector === ".chapter") {
    return [chapterContainer]
  }

  return []
}

function buildSeriesDocument() {
  const detailSpans = [
    { textContent: "2024", querySelectorAll: () => [] },
    { textContent: "", querySelectorAll: () => [{ textContent: "日本" }] },
    { textContent: "", querySelectorAll: () => [{ textContent: "少年" }] },
    {
      textContent: "",
      querySelectorAll: () => [
        { textContent: "冒险" },
        { textContent: "奇幻" },
      ],
    },
    {
      textContent: "",
      querySelectorAll: () => [{ textContent: "荒木飞吕彦" }],
    },
    { textContent: "别名", querySelectorAll: () => [] },
    { textContent: "最新", querySelectorAll: () => [] },
    { textContent: "连载中", querySelectorAll: () => [] },
    { textContent: "2026-04-15", querySelectorAll: () => [] },
  ]

  const chapterGroups = [
    {
      groupTitle: "单话",
      links: [
        {
          href: "https://www.manhuagui.com/comic/28004/760111.html",
          textContent: "第2话 重逢",
        },
        {
          href: "https://www.manhuagui.com/comic/28004/760110.html",
          textContent: "第1话 启程",
        },
        {
          href: "https://www.manhuagui.com/comic/28004/760109.html",
          textContent: "",
        },
      ],
    },
    {
      groupTitle: "单行本",
      links: [
        {
          href: "https://www.manhuagui.com/comic/28004/760210.html",
          textContent: "第1卷",
        },
      ],
    },
  ]
  const chapterContainer = buildMockChapterContainer(chapterGroups)

  return {
    querySelector: (selector: string) => {
      if (selector === ".book-cont") {
        return {
          querySelector: (nested: string) => {
            if (nested === ".book-title h1") return { textContent: "测试漫画" }
            if (nested === ".book-title h2")
              return { textContent: "Test Manga Alias" }

            if (nested === ".hcover img") {
              return {
                getAttribute: (name: string) =>
                  name === "src" ? "//cf.mhgui.com/cpic/h/28004.jpg" : null,
              }
            }

            if (nested === "#intro-all") {
              return {
                textContent: "这是一个系列简介。",
              }
            }

            return null
          },
        }
      }

      if (selector === "#checkAdult" || selector === "#__VIEWSTATE") {
        return null
      }

      return null
    },
    querySelectorAll: (selector: string) => {
      if (selector === ".detail-list span") {
        return detailSpans
      }

      return queryChapterContainers(selector, chapterContainer)
    },
  }
}

function buildAdultWarningDocument(encodedViewState: string) {
  return {
    querySelector: (selector: string) => {
      if (selector === "#checkAdult") {
        return { textContent: "成人内容提示" }
      }

      if (selector === "#__VIEWSTATE") {
        return {
          getAttribute: (name: string) =>
            name === "value" ? encodedViewState : null,
        }
      }

      if (selector === ".book-cont") {
        return null
      }

      return null
    },
    querySelectorAll: () => [],
  }
}

function buildCategorizedSeriesDocument() {
  const chapterGroups = [
    {
      groupTitle: "单行本",
      links: [
        {
          href: "https://www.manhuagui.com/comic/21243/378329.html",
          textContent: "第03卷(完)144p",
        },
        {
          href: "https://www.manhuagui.com/comic/21243/378328.html",
          textContent: "第02卷160p",
        },
        {
          href: "https://www.manhuagui.com/comic/21243/378327.html",
          textContent: "第01卷142p",
        },
      ],
    },
    {
      groupTitle: "番外篇",
      links: [
        {
          href: "https://www.manhuagui.com/comic/21243/308995.html",
          textContent: "第3卷单行…25p",
        },
        {
          href: "https://www.manhuagui.com/comic/21243/284921.html",
          textContent: "番外篇239p",
        },
      ],
    },
    {
      groupTitle: "单话",
      links: [
        {
          href: "https://www.manhuagui.com/comic/21243/307984.html",
          textContent: "新篇088p",
        },
        {
          href: "https://www.manhuagui.com/comic/21243/284923.html",
          textContent: "新篇0731p",
        },
      ],
    },
  ]
  const chapterContainer = buildMockChapterContainer(chapterGroups)

  return {
    querySelector: (selector: string) => {
      if (selector === "#checkAdult" || selector === "#__VIEWSTATE") {
        return null
      }

      return null
    },
    querySelectorAll: (selector: string) => {
      return queryChapterContainers(selector, chapterContainer)
    },
  }
}

function buildPageCountSeriesDocument() {
  const makeChapterAnchor = (
    href: string,
    chapterTitle: string,
    pageCountText: string,
    titleAttribute: string | null = chapterTitle
  ) => ({
    href,
    textContent: `${chapterTitle}${pageCountText}`,
    getAttribute: (name: string) => {
      if (name === "href") return href
      if (name === "title") return titleAttribute
      return null
    },
    querySelector: (selector: string) => {
      if (selector !== "span") {
        return null
      }

      return {
        textContent: `${chapterTitle}${pageCountText}`,
        childNodes: [
          { nodeType: 3, textContent: chapterTitle },
          { nodeType: 1, textContent: pageCountText },
        ],
      }
    },
  })

  const chapterGroups = [
    {
      groupTitle: "单话",
      links: [
        makeChapterAnchor(
          "https://www.manhuagui.com/comic/19430/100002.html",
          "第02回",
          "25p",
          null
        ),
        makeChapterAnchor(
          "https://www.manhuagui.com/comic/19430/100001.html",
          "第01回",
          "54p"
        ),
      ],
    },
  ]
  const chapterContainer = buildMockChapterContainer(chapterGroups)

  return {
    querySelector: (selector: string) => {
      if (selector === "#checkAdult" || selector === "#__VIEWSTATE") {
        return null
      }

      return null
    },
    querySelectorAll: (selector: string) => {
      return queryChapterContainers(selector, chapterContainer)
    },
  }
}

function buildPaginatedCategorySeriesDocument() {
  const singleTalkPager = {
    tagName: "DIV",
    className: "chapter-page cf mt10",
    textContent: "1-26 27-116 117-206",
  }

  const chapterGroups = [
    {
      groupTitle: "单行本",
      links: [
        {
          href: "https://www.manhuagui.com/comic/19430/585094.html",
          textContent: "第01卷190p",
          getAttribute: (name: string) =>
            name === "href"
              ? "https://www.manhuagui.com/comic/19430/585094.html"
              : null,
        },
      ],
    },
    {
      groupTitle: "单话",
      beforeList: [singleTalkPager],
      links: [
        {
          href: "https://www.manhuagui.com/comic/19430/219425.html",
          textContent: "第01回54p",
          getAttribute: (name: string) => {
            if (name === "href")
              return "https://www.manhuagui.com/comic/19430/219425.html"
            if (name === "title") return "第01回"
            return null
          },
        },
      ],
    },
    {
      groupTitle: "番外篇",
      links: [
        {
          href: "https://www.manhuagui.com/comic/19430/494877.html",
          textContent: "20卷附录8p",
          getAttribute: (name: string) =>
            name === "href"
              ? "https://www.manhuagui.com/comic/19430/494877.html"
              : null,
        },
      ],
    },
  ]
  const chapterContainer = buildMockChapterContainer(chapterGroups)

  return {
    querySelector: (selector: string) => {
      if (selector === "#checkAdult" || selector === "#__VIEWSTATE") {
        return null
      }

      return null
    },
    querySelectorAll: (selector: string) => {
      return queryChapterContainers(selector, chapterContainer)
    },
  }
}

const readerConfigScript = `
  pVars={page:1,curServ:0,priServ:3,curHost:3,curFunc:0,curFile:"",manga:{preLoadNumber:1}};
  SMH.picserv=function(){var t=[{name:"自动",hosts:[{h:"i",w:.1},{h:"eu",w:4},{h:"eu1",w:4},{h:"eu2",w:4},{h:"us",w:1},{h:"us1",w:1},{h:"us2",w:1},{h:"us3",w:1}]},{name:"电信",hosts:[{h:"eu",w:1},{h:"eu1",w:1},{h:"eu2",w:1}]},{name:"联通",hosts:[{h:"us",w:1},{h:"us1",w:1},{h:"us2",w:1},{h:"us3",w:1}]}],n=[],i=[],r=0;return{}}();
`

function buildPackedChapterHtml(
  rawKeys: string,
  path = "/ps4/z/zhoushuhz_jjx/第01回/"
) {
  return `
    <script src="//cf.mhgui.com/scripts/config_TEST.js"></script>
    <script>
      window["eval"](function(p,a,c,k,e,d){return p;}('SMH.imgData({"files":["001.jpg.webp","002.jpg.webp"],"path":"${path}","sl":{"e":1712345678,"m":"abc123"}}).preInit();',62,0,'${rawKeys}'['split']('|'),0,{}))
    </script>
  `
}

export function registerManhuaguiCases(): void {
  describe("Manhuagui integration", () => {
    it("extracts series id from /comic/{id}/ pages", async () => {
      const snapshot = captureBrowserGlobals()
      setTestWindow({ location: { pathname: "/comic/28004/" } })

      expect(parseSeriesIdFromPath(window.location.pathname)).toBe("28004")

      restoreBrowserGlobals(snapshot)
    })

    it("extracts metadata from the series page structure", async () => {
      const snapshot = captureBrowserGlobals()
      setTestWindow({
        location: {
          pathname: "/comic/28004/",
          origin: "https://www.manhuagui.com",
        },
      })
      setTestDocument(buildSeriesDocument())

      const metadata = extractSeriesMetadataFromDocument(document)
      expect(metadata).toMatchObject({
        title: "测试漫画",
        author: "荒木飞吕彦",
        description: "这是一个系列简介。",
        coverUrl: "https://cf.mhgui.com/cpic/h/28004.jpg",
        alternativeTitles: ["Test Manga Alias"],
        status: "连载中",
        year: 2024,
        genres: ["冒险", "奇幻"],
        language: "zh",
      })
      expect(metadata.readingDirection).toBeUndefined()

      restoreBrowserGlobals(snapshot)
    })

    it("extracts grouped chapter lists from the series DOM", async () => {
      const snapshot = captureBrowserGlobals()
      setTestWindow({
        location: {
          pathname: "/comic/28004/",
          origin: "https://www.manhuagui.com",
        },
      })
      setTestDocument(buildSeriesDocument())

      const chapterResult = extractChapterListFromDocument(document)
      const chapters = Array.isArray(chapterResult)
        ? chapterResult
        : chapterResult.chapters

      expect(chapters).toHaveLength(4)
      expect(chapters.map((chapter) => chapter.id)).toEqual([
        "760110",
        "760111",
        "760109",
        "760210",
      ])
      expect(chapters[0]).toMatchObject({
        title: "第1话 启程",
        chapterNumber: 1,
        volumeLabel: "单话",
        url: "https://www.manhuagui.com/comic/28004/760110.html",
      })
      expect(chapters[0]?.comicInfo?.Manga).toBeUndefined()
      expect(chapters[2]).toMatchObject({
        title: "Chapter 760109",
        chapterLabel: "Chapter 760109",
      })
      expect(chapters[3]).toMatchObject({
        title: "第1卷",
        chapterNumber: 1,
        volumeLabel: "单行本",
      })

      restoreBrowserGlobals(snapshot)
    })

    it("removes Manhuagui page-count suffixes from chapter titles and labels", async () => {
      const snapshot = captureBrowserGlobals()
      setTestWindow({
        location: {
          pathname: "/comic/19430/",
          origin: "https://www.manhuagui.com",
        },
      })
      setTestDocument(buildPageCountSeriesDocument())

      const chapterResult = extractChapterListFromDocument(document)
      const chapters = Array.isArray(chapterResult)
        ? chapterResult
        : chapterResult.chapters

      expect(chapters).toHaveLength(2)
      expect(chapters[0]).toMatchObject({
        id: "100001",
        title: "第01回",
        chapterLabel: "第01回",
        chapterNumber: 1,
        volumeLabel: "单话",
      })
      expect(chapters[0]?.comicInfo.Title).toBe("第01回")
      expect(chapters[1]).toMatchObject({
        id: "100002",
        title: "第02回",
        chapterLabel: "第02回",
        chapterNumber: 2,
      })

      restoreBrowserGlobals(snapshot)
    })

    it("returns Manhuagui series category headings as explicit volumes", async () => {
      const snapshot = captureBrowserGlobals()
      setTestWindow({
        location: {
          pathname: "/comic/21243/",
          origin: "https://www.manhuagui.com",
        },
      })
      setTestDocument(buildCategorizedSeriesDocument())

      const chapterResult = extractChapterListFromDocument(document)
      expect(Array.isArray(chapterResult)).toBe(false)
      if (Array.isArray(chapterResult)) {
        throw new Error(
          "Expected Manhuagui extractChapterList to return chapters with volumes"
        )
      }

      expect(chapterResult.volumes).toEqual([
        { id: "manhuagui-volume-1", title: "单行本", label: "单行本" },
        { id: "manhuagui-volume-2", title: "番外篇", label: "番外篇" },
        { id: "manhuagui-volume-3", title: "单话", label: "单话" },
      ])
      expect(chapterResult.chapters).toHaveLength(7)
      expect(
        chapterResult.chapters.map((chapter) => ({
          id: chapter.id,
          volumeId: chapter.volumeId,
          volumeLabel: chapter.volumeLabel,
          volumeNumber: chapter.volumeNumber,
        }))
      ).toEqual([
        {
          id: "378327",
          volumeId: "manhuagui-volume-1",
          volumeLabel: "单行本",
          volumeNumber: undefined,
        },
        {
          id: "378328",
          volumeId: "manhuagui-volume-1",
          volumeLabel: "单行本",
          volumeNumber: undefined,
        },
        {
          id: "378329",
          volumeId: "manhuagui-volume-1",
          volumeLabel: "单行本",
          volumeNumber: undefined,
        },
        {
          id: "308995",
          volumeId: "manhuagui-volume-2",
          volumeLabel: "番外篇",
          volumeNumber: undefined,
        },
        {
          id: "284921",
          volumeId: "manhuagui-volume-2",
          volumeLabel: "番外篇",
          volumeNumber: undefined,
        },
        {
          id: "307984",
          volumeId: "manhuagui-volume-3",
          volumeLabel: "单话",
          volumeNumber: undefined,
        },
        {
          id: "284923",
          volumeId: "manhuagui-volume-3",
          volumeLabel: "单话",
          volumeNumber: undefined,
        },
      ])

      restoreBrowserGlobals(snapshot)
    })

    it("uses the nearest preceding category heading when pagination controls sit before a chapter list", async () => {
      const snapshot = captureBrowserGlobals()
      setTestWindow({
        location: {
          pathname: "/comic/19430/",
          origin: "https://www.manhuagui.com",
        },
      })
      setTestDocument(buildPaginatedCategorySeriesDocument())

      const chapterResult = extractChapterListFromDocument(document)
      expect(Array.isArray(chapterResult)).toBe(false)
      if (Array.isArray(chapterResult)) {
        throw new Error(
          "Expected Manhuagui extractChapterList to return chapters with volumes"
        )
      }

      const volumes = chapterResult.volumes ?? []
      expect(volumes.map((volume) => volume.title)).toEqual([
        "单行本",
        "单话",
        "番外篇",
      ])
      expect(
        chapterResult.chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
          volumeLabel: chapter.volumeLabel,
        }))
      ).toEqual([
        { id: "585094", title: "第01卷190p", volumeLabel: "单行本" },
        { id: "219425", title: "第01回", volumeLabel: "单话" },
        { id: "494877", title: "20卷附录8p", volumeLabel: "番外篇" },
      ])

      restoreBrowserGlobals(snapshot)
    })

    it("does not expose adult chapters hidden behind the site warning", async () => {
      const snapshot = captureBrowserGlobals()
      const adultChapterMarkup = `
        <h4>限制级</h4>
        <div class="chapter-list" id="chapter-list-1">
          <ul>
            <li><a href="/comic/21243/900001.html">第1话 夜幕</a></li>
            <li><a href="/comic/21243/900002.html">第2话 余烬</a></li>
          </ul>
        </div>
      `

      class MockDomParser {
        parseFromString(_html: string) {
          const chapterContainer = buildMockChapterContainer([
            {
              groupTitle: "限制级",
              links: [
                {
                  href: "https://www.manhuagui.com/comic/21243/900001.html",
                  textContent: "第1话 夜幕",
                },
                {
                  href: "https://www.manhuagui.com/comic/21243/900002.html",
                  textContent: "第2话 余烬",
                },
              ],
            },
          ])

          return {
            querySelector: () => null,
            querySelectorAll: (selector: string) => {
              return queryChapterContainers(selector, chapterContainer)
            },
          }
        }
      }

      setTestWindow({
        location: {
          pathname: "/comic/21243/",
          origin: "https://www.manhuagui.com",
        },
      })
      setTestDocument(
        buildAdultWarningDocument(compressToBase64(adultChapterMarkup))
      )
      Object.defineProperty(globalThis, "DOMParser", {
        value: MockDomParser,
        configurable: true,
      })

      const chapterResult = extractChapterListFromDocument(document)
      const chapters = Array.isArray(chapterResult)
        ? chapterResult
        : chapterResult.chapters

      expect(chapters).toEqual([])

      restoreBrowserGlobals(snapshot)
    })

    it("does not decode relative chapter links from adult __VIEWSTATE", async () => {
      const snapshot = captureBrowserGlobals()
      const adultChapterMarkup = `
        <h4>限制级</h4>
        <div class="chapter-list" id="chapter-list-1">
          <ul>
            <li><a href="/comic/21243/900001.html">第1话 夜幕</a></li>
          </ul>
        </div>
      `

      class MockDomParser {
        parseFromString(_html: string) {
          const chapterContainer = buildMockChapterContainer([
            {
              groupTitle: "限制级",
              links: [
                {
                  href: "about:blank/comic/21243/900001.html",
                  getAttribute: (name: string) =>
                    name === "href" ? "/comic/21243/900001.html" : null,
                  textContent: "第1话 夜幕",
                },
              ],
            },
          ])

          return {
            querySelector: () => null,
            querySelectorAll: (selector: string) => {
              return queryChapterContainers(selector, chapterContainer)
            },
          }
        }
      }

      setTestWindow({
        location: {
          pathname: "/comic/21243/",
          origin: "https://www.manhuagui.com",
        },
      })
      setTestDocument(
        buildAdultWarningDocument(compressToBase64(adultChapterMarkup))
      )
      Object.defineProperty(globalThis, "DOMParser", {
        value: MockDomParser,
        configurable: true,
      })

      const chapterResult = extractChapterListFromDocument(document)
      const chapters = Array.isArray(chapterResult)
        ? chapterResult
        : chapterResult.chapters

      expect(chapters).toEqual([])

      restoreBrowserGlobals(snapshot)
    })

    it("parses packed viewer HTML into hamreus image URLs using the site config script", async () => {
      const compressedKeys = compressToBase64("")
      const chapterHtml = buildPackedChapterHtml(compressedKeys)
      mockRateLimitedFetch.mockResolvedValueOnce(
        makeHtmlResponse(
          readerConfigScript,
          "application/javascript; charset=utf-8"
        )
      )

      const { manhuaguiIntegration } =
        await import("@/src/site-integrations/manhuagui")
      const urls =
        await manhuaguiIntegration.background.chapter.parseImageUrlsFromHtml?.({
          chapterId: "760110",
          chapterUrl: "https://www.manhuagui.com/comic/28004/760110.html",
          chapterHtml,
        })

      expect(urls).toEqual([
        "https://eu2.hamreus.com/ps4/z/zhoushuhz_jjx/第01回/001.jpg.webp?e=1712345678&m=abc123",
        "https://eu2.hamreus.com/ps4/z/zhoushuhz_jjx/第01回/002.jpg.webp?e=1712345678&m=abc123",
      ])
      expect(mockRateLimitedFetch).toHaveBeenCalledWith(
        "manhuagui",
        "https://cf.mhgui.com/scripts/config_TEST.js",
        "chapter",
        { credentials: "omit" },
        undefined
      )
    })

    it("resolveImageUrls fetches chapter HTML and the config script to reconstruct filePath", async () => {
      const compressedKeys = compressToBase64("")
      mockRateLimitedFetch
        .mockResolvedValueOnce(
          makeHtmlResponse(
            buildPackedChapterHtml(
              compressedKeys,
              "/ps4/z/zhoushuhz_jjx/第02回/"
            )
          )
        )
        .mockResolvedValueOnce(
          makeHtmlResponse(
            readerConfigScript,
            "application/javascript; charset=utf-8"
          )
        )

      const { manhuaguiIntegration } =
        await import("@/src/site-integrations/manhuagui")
      const urls =
        await manhuaguiIntegration.background.chapter.resolveImageUrls?.({
          id: "760111",
          url: "https://www.manhuagui.com/comic/28004/760111.html",
        })

      expect(urls).toEqual([
        "https://eu2.hamreus.com/ps4/z/zhoushuhz_jjx/第02回/001.jpg.webp?e=1712345678&m=abc123",
        "https://eu2.hamreus.com/ps4/z/zhoushuhz_jjx/第02回/002.jpg.webp?e=1712345678&m=abc123",
      ])
      expect(mockRateLimitedFetch).toHaveBeenNthCalledWith(
        1,
        "manhuagui",
        "https://www.manhuagui.com/comic/28004/760111.html",
        "chapter",
        { credentials: "include" },
        undefined
      )
      expect(mockRateLimitedFetch).toHaveBeenNthCalledWith(
        2,
        "manhuagui",
        "https://cf.mhgui.com/scripts/config_TEST.js",
        "chapter",
        { credentials: "omit" },
        undefined
      )
    })

    it("relies on DNR rather than ineffective Fetch referrer options for Hamreus images", async () => {
      mockRateLimitedFetch.mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (name: string) =>
            name === "content-type" ? "image/webp" : null,
        },
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      })

      const { manhuaguiIntegration } =
        await import("@/src/site-integrations/manhuagui")
      const result =
        await manhuaguiIntegration.background.chapter.downloadImage(
          "https://us.hamreus.com/ps4/g/h/i/003.jpg?e=1712345679&m=def456"
        )

      expect(result).toMatchObject({
        filename: "003.jpg",
        mimeType: "image/webp",
      })
      expect(result.data.byteLength).toBe(4)

      const [integrationId, requestUrl, scope, requestInit] =
        mockRateLimitedFetch.mock.calls[0] as [
          string,
          string,
          string,
          RequestInit,
        ]
      expect(integrationId).toBe("manhuagui")
      expect(requestUrl).toBe(
        "https://us.hamreus.com/ps4/g/h/i/003.jpg?e=1712345679&m=def456"
      )
      expect(scope).toBe("image")
      expect(requestInit.credentials).toBe("omit")
      expect(requestInit.referrer).toBeUndefined()
      expect(requestInit.referrerPolicy).toBeUndefined()
      expect(requestInit.headers).toBeUndefined()
    })

    it("rejects non-raster image responses before returning downloaded image data", async () => {
      mockRateLimitedFetch.mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (name: string) =>
            name === "content-type" ? "text/html; charset=utf-8" : null,
        },
        arrayBuffer: async () =>
          new TextEncoder().encode("<html>captcha</html>").buffer,
      })

      const { manhuaguiIntegration } =
        await import("@/src/site-integrations/manhuagui")

      await expect(
        manhuaguiIntegration.background.chapter.downloadImage(
          "https://us.hamreus.com/ps4/g/h/i/003.jpg?e=1712345679&m=def456"
        )
      ).rejects.toThrow("Unsupported MIME type: text/html")
    })

    describe("adult-gate handling", () => {
      it("parseImageUrlsFromHtml raises an actionable age-gate error when the cookie was not honored", async () => {
        const ageGateHtml = `
          <html>
            <body>
              <div id="checkAdult" class="w980 mt10">
                <p>本漫画为成年读者向，请确认您年满18周岁后再继续访问。</p>
                <a href="javascript:showAdultInfo();" onclick="showAdultInfo();">成年读者，请点击此处进入</a>
              </div>
            </body>
          </html>
        `

        const { manhuaguiIntegration } =
          await import("@/src/site-integrations/manhuagui")
        const parseImageUrlsFromHtml =
          manhuaguiIntegration.background.chapter.parseImageUrlsFromHtml
        expect(parseImageUrlsFromHtml).toBeDefined()
        if (!parseImageUrlsFromHtml) {
          throw new Error("Expected parseImageUrlsFromHtml to be defined")
        }

        await expect(
          parseImageUrlsFromHtml({
            chapterId: "760110",
            chapterUrl: "https://www.manhuagui.com/comic/28004/760110.html",
            chapterHtml: ageGateHtml,
          })
        ).rejects.toThrow(/complete the site consent prompt/)
      })
    })
  })
}
