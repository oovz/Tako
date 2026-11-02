import { readFileSync } from "node:fs"
import {
  createExpandedSiteFixture,
  htmlResponse,
  pngResponse,
} from "../expanded-site-fixture"

const origin = "https://newm.mangahere.cc"
const cdn = "https://zjcdn.mangahere.org"
const path = "/manga/hunter_x_hunter/"
const readerPath = `${path}v01/c001/1.html`
const fixturePath = "tests/fixtures/site-integrations/mangahere"
const series = readFileSync(`${fixturePath}/series-page.html`, "utf8")
const reader = readFileSync(`${fixturePath}/hunter-reader.html`, "utf8")

export const mangahereFixture = createExpandedSiteFixture({
  testCase: {
    id: "mangahere",
    seriesUrl: origin + path,
    seriesId: "hunter_x_hunter",
    title: "Hunter X Hunter",
    chapterId: "hunter_x_hunter/v01/c001",
    pageCount: 33,
  },
  origins: [origin, cdn, "https://fmcdn.mangahere.com"],
  firstRuleId: 9988,
  handle: ({ url }) => {
    if (url.origin === cdn || url.hostname === "fmcdn.mangahere.com")
      return pngResponse()
    if (url.pathname === path)
      return htmlResponse(series.replace(/<img\b[^>]*>/g, ""))
    if (url.pathname === readerPath) return htmlResponse(reader)
    return null
  },
})
export const registerMangahereRoutes = mangahereFixture.registerRoutes
export const registerMangahereLocalServerHandlers =
  mangahereFixture.registerLocalServerHandlers
