import { readFileSync } from "node:fs"
import {
  createExpandedSiteFixture,
  htmlResponse,
  pngResponse,
} from "../expanded-site-fixture"
import { boylovePagePng } from "./image-fixture"

const origin = "https://boylove.cc"
const cdn = "https://img.boylove.cc"
const chapterId = "2671926"
const series = readFileSync(
  new URL(
    "../../../../../../tests/fixtures/site-integrations/boylove/series.html",
    import.meta.url
  ),
  "utf8"
)
const reader = readFileSync(
  new URL(
    "../../../../../../tests/fixtures/site-integrations/boylove/reader.html",
    import.meta.url
  ),
  "utf8"
)
const pages: { src: string; width: number; height: string }[] = JSON.parse(
  reader.match(/\bvar\s+imageData\s*=\s*(\[[\s\S]*?\])\s*;/)![1]
)
const dimensions = new Map(pages.map((page) => [page.src, page]))

export const boyloveFixture = createExpandedSiteFixture({
  testCase: {
    id: "boylove",
    seriesUrl: `${origin}/home/book/index/id/32391`,
    seriesId: "32391",
    title: "猎人只想安静生活【台版】",
    chapterId,
    pageCount: 35,
  },
  origins: [origin, cdn],
  firstRuleId: 9906,
  handle: ({ url }) => {
    if (url.origin === cdn) {
      const page = dimensions.get(url.href)
      return page
        ? {
            status: 200,
            headers: { "content-type": "image/png" },
            body: boylovePagePng(page.width, Math.floor(Number(page.height))),
          }
        : pngResponse()
    }
    if (url.pathname === "/home/book/index/id/32391")
      return htmlResponse(series)
    if (url.pathname === `/home/book/capter/id/${chapterId}`)
      return htmlResponse(reader)
    return null
  },
})
export const registerBoyloveRoutes = boyloveFixture.registerRoutes
export const registerBoyloveLocalServerHandlers =
  boyloveFixture.registerLocalServerHandlers
