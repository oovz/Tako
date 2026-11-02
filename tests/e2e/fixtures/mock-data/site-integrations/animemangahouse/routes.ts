import { readFileSync } from "node:fs"
import contract from "@/tests/fixtures/site-integrations/animemangahouse/contract.json" with { type: "json" }
import {
  createExpandedSiteFixture,
  htmlResponse,
  pngResponse,
} from "../expanded-site-fixture"

const origin = "https://www.dm5.com"
const cdn = "https://manhua1032zjcdn26.cdndm5.com"
const series = readFileSync(
  "tests/fixtures/site-integrations/animemangahouse/series.html",
  "utf8"
)
const reader = readFileSync(
  "tests/fixtures/site-integrations/animemangahouse/reader.html",
  "utf8"
)

export const dm5Fixture = createExpandedSiteFixture({
  testCase: {
    id: "animemangahouse",
    seriesUrl: `${origin}/manhua-shanhainizhan1/`,
    seriesId: "33991",
    title: "山海逆战",
    chapterId: "521974",
    pageCount: 13,
  },
  origins: [origin, cdn, "https://mhfm2us.cdndm5.com"],
  firstRuleId: 9940,
  handle: ({ url }) => {
    if (url.origin === cdn || url.origin === "https://mhfm2us.cdndm5.com")
      return pngResponse()
    if (url.pathname === "/manhua-shanhainizhan1/") return htmlResponse(series)
    if (url.pathname.endsWith("chapterfun.ashx"))
      return {
        status: 200,
        headers: { "content-type": "text/javascript" },
        body:
          Number(url.searchParams.get("page")) === 1
            ? contract.data.signedResponse
            : contract.data.signedResponse
                .replace(
                  "|2_4711|",
                  `|fixture-page-${url.searchParams.get("page")}|`
                )
                .replace(
                  "|3_3844|",
                  `|fixture-page-${Number(url.searchParams.get("page")) + 1}|`
                ),
      }
    if (url.pathname === "/m521974/") return htmlResponse(reader)
    return null
  },
})
export const registerDm5Routes = dm5Fixture.registerRoutes
export const registerDm5LocalServerHandlers =
  dm5Fixture.registerLocalServerHandlers
