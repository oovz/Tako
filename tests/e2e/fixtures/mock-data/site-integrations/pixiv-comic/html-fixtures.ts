import { readFileSync } from "node:fs"
import { MINIMAL_SERIES } from "./series-data"

const fixturePath = "tests/fixtures/site-integrations/pixiv-comic"

// Stripped app DOM from the supplied 2026-10-25 captures. Bootstrap scripts are inert.
export const BASIC_WORK_PAGE_HTML = readFileSync(
  `${fixturePath}/series.html`,
  "utf8"
)
export const VIEWER_PAGE_HTML = readFileSync(
  `${fixturePath}/reader.html`,
  "utf8"
)

// Synthetic controls for navigation to a second work and a non-work route.
export function buildPixivComicWorkPageHtml(
  workId: string,
  title: string
): string {
  const canonicalUrl = `https://comic.pixiv.net/works/${workId}`
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<link rel="canonical" href="${canonicalUrl}"><title>${title} - pixivコミック</title>
</head><body><div id="__next"><div><h1>${title}</h1></div></div></body></html>`
}

export const MINIMAL_WORK_PAGE_HTML = buildPixivComicWorkPageHtml(
  MINIMAL_SERIES.series.seriesId,
  MINIMAL_SERIES.series.seriesTitle
)

export const HOME_PAGE_HTML = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>pixivコミック</title></head><body><div id="__next"></div></body></html>`
