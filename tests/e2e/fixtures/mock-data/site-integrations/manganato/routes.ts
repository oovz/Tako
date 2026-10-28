import { readFileSync } from "node:fs"
import {
  createExpandedSiteFixture,
  htmlResponse,
  jsonResponse,
  pngResponse,
} from "../expanded-site-fixture"

type CapturedChapterPage = {
  data: {
    chapters: {
      chapter_name: string
      chapter_slug: string
      chapter_num: number
    }[]
  }
}

export function createManganatoBrowserFixture(
  id: "manganato" | "mangakakalot",
  domain: string,
  firstRuleId: number
) {
  const origin = `https://www.${domain}`
  const fixturePath = `tests/fixtures/site-integrations/${id}`
  const series = readFileSync(`${fixturePath}/series-page.html`, "utf8")
  const reader = readFileSync(`${fixturePath}/reader.html`, "utf8")
  const pages = JSON.parse(
    readFileSync(`${fixturePath}/captured-chapters.json`, "utf8")
  ) as CapturedChapterPage[]
  const chapters = pages.flatMap((page) => page.data.chapters)
  const slug = "hunter-x-hunter"
  return createExpandedSiteFixture({
    testCase: {
      id,
      seriesUrl: `${origin}/manga/${slug}`,
      seriesId: slug,
      title: "Hunter X Hunter",
      chapterId: "chapter-0",
      pageCount: 30,
    },
    origins: [
      origin,
      `https://${domain}`,
      "https://img-r1.2xstorage.com",
      "https://img-r2.2xstorage.com",
    ],
    firstRuleId,
    handle: ({ url }) => {
      if (
        ["img-r1.2xstorage.com", "img-r2.2xstorage.com"].includes(url.hostname)
      )
        return pngResponse()
      if (url.pathname === `/api/manga/${slug}/chapters`) {
        const offset = Number(url.searchParams.get("offset"))
        const limit = Number(url.searchParams.get("limit"))
        if (!Number.isInteger(offset) || offset < 0 || limit !== 50) return null
        return jsonResponse({
          success: true,
          data: {
            chapters: chapters.slice(offset, offset + limit),
            pagination: {
              total: chapters.length,
              limit,
              offset,
              has_more: offset + limit < chapters.length,
            },
          },
        })
      }
      if (url.pathname === `/manga/${slug}`) return htmlResponse(series)
      if (url.pathname === `/manga/${slug}/chapter-0`)
        return htmlResponse(reader)
      return null
    },
  })
}

export const manganatoFixture = createManganatoBrowserFixture(
  "manganato",
  "manganato.gg",
  9980
)
export const registerManganatoRoutes = manganatoFixture.registerRoutes
export const registerManganatoLocalServerHandlers =
  manganatoFixture.registerLocalServerHandlers
