import { readFileSync } from "node:fs"
import {
  createExpandedSiteFixture,
  htmlResponse,
  pngResponse,
} from "../expanded-site-fixture"

const origin = "https://mycomic.com"
const chapterId = "492177"
const series = readFileSync(
  new URL(
    "../../../../../../tests/fixtures/site-integrations/mycomic/series.html",
    import.meta.url
  ),
  "utf8"
)
const reader = readFileSync(
  new URL(
    "../../../../../../tests/fixtures/site-integrations/mycomic/reader.html",
    import.meta.url
  ),
  "utf8"
)

export const mycomicFixture = createExpandedSiteFixture({
  testCase: {
    id: "mycomic",
    seriesUrl: `${origin}/cn/comics/35937`,
    seriesId: "35937",
    title: "葬送者芙莉莲",
    chapterId,
    pageCount: 39,
  },
  origins: [origin, "https://biccam.com"],
  firstRuleId: 9908,
  handle: ({ url }) => {
    if (url.origin === "https://biccam.com") return pngResponse()
    if (url.pathname === "/cn/comics/35937") return htmlResponse(series)
    if (url.pathname === `/cn/chapters/${chapterId}`)
      return htmlResponse(reader)
    return null
  },
})
export const registerMycomicRoutes = mycomicFixture.registerRoutes
export const registerMycomicLocalServerHandlers =
  mycomicFixture.registerLocalServerHandlers
