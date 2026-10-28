import { readFileSync } from "node:fs"
import contract from "@/tests/fixtures/site-integrations/mangago/contract.json" with { type: "json" }
import {
  createExpandedSiteFixture,
  htmlResponse,
  pngResponse,
} from "../expanded-site-fixture"

const origin = "https://www.mangago.me"
const scriptOrigin = "https://pic1.mangapicgallery.com"
const cdn = "https://iweb_9.mangapicgallery.com"
const coverOrigin = "https://i8.mangapicgallery.com"
const { seriesId, seriesUrl, readerUrl } = contract.data
const series = readFileSync(
  new URL(
    "../../../../../../tests/fixtures/site-integrations/mangago/series.html",
    import.meta.url
  ),
  "utf8"
)
const reader = readFileSync(
  new URL(
    "../../../../../../tests/fixtures/site-integrations/mangago/reader.html",
    import.meta.url
  ),
  "utf8"
)

export const mangagoFixture = createExpandedSiteFixture({
  testCase: {
    id: "mangago",
    seriesUrl,
    seriesId,
    title: "Hunter X Hunter",
    chapterId: "an:nml_chapter-420",
    pageCount: 19,
    aliases: [seriesUrl.replace("www.mangago.me", "mangago.me")],
  },
  origins: [origin, scriptOrigin, cdn, coverOrigin, "https://mangago.me"],
  firstRuleId: 9970,
  handle: ({ url }) => {
    if (url.origin === cdn || url.origin === coverOrigin) return pngResponse()
    if (url.origin === scriptOrigin && url.pathname === "/js/chapter.js")
      return {
        status: 200,
        headers: { "content-type": "text/javascript" },
        body: contract.data.protocolScript,
      }
    if (url.pathname === new URL(seriesUrl).pathname)
      return htmlResponse(series)
    if (url.pathname === new URL(readerUrl).pathname)
      return htmlResponse(reader)
    return null
  },
})
export const registerMangagoRoutes = mangagoFixture.registerRoutes
export const registerMangagoLocalServerHandlers =
  mangagoFixture.registerLocalServerHandlers
