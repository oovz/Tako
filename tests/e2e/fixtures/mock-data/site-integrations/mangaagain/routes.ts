import { readFileSync } from "node:fs"
import contract from "@/tests/fixtures/site-integrations/mangaagain/contract.json" with { type: "json" }
import {
  createExpandedSiteFixture,
  htmlResponse,
  jsonResponse,
  pngResponse,
} from "../expanded-site-fixture"

const origin = "https://www.zaimanhua.com"
const alias = "https://manhua.zaimanhua.com"
const cdn = "https://images.zaimanhua.com"
const fixture = contract.data
const series = readFileSync(
  new URL(
    "../../../../../../tests/fixtures/site-integrations/mangaagain/series.html",
    import.meta.url
  ),
  "utf8"
)

export const zaimanhuaFixture = createExpandedSiteFixture({
  testCase: {
    id: "mangaagain",
    seriesUrl: `${origin}/info/doufo.html`,
    aliases: [`${alias}/info/doufo.html`],
    seriesId: "83175",
    title: "斗佛",
    chapterId: "195373",
    pageCount: 7,
  },
  origins: [origin, alias, cdn],
  firstRuleId: 9914,
  handle: ({ url, headers }) => {
    if (url.origin === cdn) return pngResponse()
    if (url.pathname === "/info/doufo.html") return htmlResponse(series)
    const variant = url.origin === alias ? "comic2" : "comic1"
    if (url.pathname.startsWith(`/api/v1/${variant}/`)) {
      if (headers.platform !== "pc")
        return { status: 403, body: "Platform header missing" }
      if (
        url.pathname === `/api/v1/${variant}/comic/detail` &&
        url.searchParams.get("comic_py") === "doufo"
      )
        return jsonResponse(
          variant === "comic2" ? fixture.seriesComic2 : fixture.series
        )
      if (
        url.pathname === `/api/v1/${variant}/chapter/detail` &&
        url.searchParams.get("comic_id") === "83175" &&
        url.searchParams.get("chapter_id") === "195373"
      )
        return jsonResponse(fixture.chapter)
    }
    return null
  },
})
export const registerZaimanhuaRoutes = zaimanhuaFixture.registerRoutes
export const registerZaimanhuaLocalServerHandlers =
  zaimanhuaFixture.registerLocalServerHandlers
