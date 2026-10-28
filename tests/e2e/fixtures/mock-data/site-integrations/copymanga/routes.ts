import { readFileSync } from "node:fs"
import {
  createExpandedSiteFixture,
  htmlResponse,
  jsonResponse,
  pngResponse,
} from "../expanded-site-fixture"

const origin = "https://www.copy3000.com"
const alias = "https://www.copy4000.com"
const cdn = "https://sd.mangafunb.fun"
const chapterId = "dc312a94-f526-11e8-a7d3-00163e0ca5bd"
const series = readFileSync(
  new URL(
    "../../../../../../tests/fixtures/site-integrations/copymanga/series.html",
    import.meta.url
  ),
  "utf8"
)
const reader = readFileSync(
  new URL(
    "../../../../../../tests/fixtures/site-integrations/copymanga/reader-dianjuren.html",
    import.meta.url
  ),
  "utf8"
)
const catalog = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../../tests/fixtures/site-integrations/copymanga/catalog-dianjuren.json",
      import.meta.url
    ),
    "utf8"
  )
) as { code: number; results: string }

export const copyFixture = createExpandedSiteFixture({
  testCase: {
    id: "copymanga",
    seriesUrl: `${origin}/comic/dianjuren`,
    aliases: [`${alias}/comic/dianjuren`],
    seriesId: "dianjuren",
    title: "電鋸人",
    chapterId,
    pageCount: 53,
  },
  origins: [origin, alias, cdn],
  firstRuleId: 9917,
  handle: ({ url, headers }) => {
    if (url.origin === cdn) return pngResponse()
    if (url.pathname === "/comic/dianjuren") return htmlResponse(series)
    if (url.pathname === "/comicdetail/dianjuren/chapters") {
      if (
        headers.dnts !== "9" ||
        !/^application\/x-www-form-urlencoded;\s*charset=utf-8$/i.test(
          String(headers["content-type"] ?? "")
        )
      ) {
        return {
          status: 400,
          headers: { "content-type": "application/json" },
          body: { code: 400, message: "Missing catalog request fields" },
        }
      }
      return jsonResponse(catalog)
    }
    if (url.pathname === `/comic/dianjuren/chapter/${chapterId}`)
      return htmlResponse(reader)
    return null
  },
})
export const registerCopyRoutes = copyFixture.registerRoutes
export const registerCopyLocalServerHandlers =
  copyFixture.registerLocalServerHandlers
