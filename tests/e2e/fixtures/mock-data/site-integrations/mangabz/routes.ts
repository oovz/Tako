import { readFileSync } from "node:fs"
import contract from "@/tests/fixtures/site-integrations/mangabz/contract.json" with { type: "json" }
import {
  createExpandedSiteFixture,
  htmlResponse,
  pngResponse,
} from "../expanded-site-fixture"

const origin = "https://www.mangabz.com"
const cdn = "https://image.mangabz.com"
const series = readFileSync(
  "tests/fixtures/site-integrations/mangabz/series.html",
  "utf8"
)
const reader = readFileSync(
  "tests/fixtures/site-integrations/mangabz/reader.html",
  "utf8"
)

export const mangabzFixture = createExpandedSiteFixture({
  testCase: {
    id: "mangabz",
    seriesUrl: `${origin}/139bz/`,
    seriesId: "139",
    title: "海賊王",
    chapterId: "29397",
    pageCount: 20,
  },
  origins: [origin, cdn, "https://cover.mangabz.com"],
  firstRuleId: 9943,
  handle: ({ url }) => {
    if (url.origin === cdn || url.origin === "https://cover.mangabz.com")
      return pngResponse()
    if (url.pathname === "/139bz/") return htmlResponse(series)
    if (url.pathname.endsWith("chapterimage.ashx"))
      return {
        status: 200,
        headers: { "content-type": "text/javascript" },
        body:
          Number(url.searchParams.get("page")) === 1
            ? contract.data.signedResponse
            : contract.data.signedResponse
                .replace(
                  "|1_5790|",
                  `|fixture-page-${url.searchParams.get("page")}|`
                )
                .replace(
                  "|2_7019|",
                  `|fixture-page-${Number(url.searchParams.get("page")) + 1}|`
                ),
      }
    if (url.pathname === "/m29397/") return htmlResponse(reader)
    return null
  },
})
export const registerMangabzRoutes = mangabzFixture.registerRoutes
export const registerMangabzLocalServerHandlers =
  mangabzFixture.registerLocalServerHandlers
