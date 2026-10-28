/** Normal and adult-gated Manhuagui series pages, plus chapter-reader HTML. */

import { readFileSync } from "node:fs"

import { compressToBase64 } from "../../../../../shared/manhuagui-compress"
import {
  MANHUAGUI_CONFIG_SCRIPT_URL,
  buildManhuaguiChapterPathSegment,
  buildManhuaguiChapterSlMetadata,
  buildManhuaguiPackedPayloadScript,
  type ManhuaguiPackedImageData,
} from "./api-fixtures"
import {
  ADULT_CHAPTERS,
  BASIC_CHAPTERS,
  CATEGORY_CHAPTERS,
  SMALL_SERIES,
} from "./chapter-data"
import { buildManhuaguiImageFilenames } from "./image-fixtures"
import {
  ADULT_SERIES,
  BASIC_SERIES,
  CATEGORY_SERIES,
  MINIMAL_SERIES,
} from "./series-data"

interface SeriesPageChapterGroup {
  volumeLabel: string
  chapters: Array<{
    id: string
    url: string
    title: string
    displayTitle?: string
  }>
  beforeListHtml?: string
}

interface BuildSeriesPageHtmlOptions {
  seriesId: string
  seriesTitle: string
  author?: string
  description?: string
  coverUrl?: string
  status?: string
  groups: SeriesPageChapterGroup[]
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function renderChapterListBlocks(groups: SeriesPageChapterGroup[]): string {
  return groups
    .map((group) =>
      `
      <h4>${escapeHtml(group.volumeLabel)}</h4>
      ${group.beforeListHtml ?? ""}
      <div class="chapter-list">
        <ul>
          ${group.chapters
            .map(
              (chapter) =>
                `<li><a href="${escapeHtml(new URL(chapter.url).pathname)}" title="${escapeHtml(chapter.title)}"><span>${chapter.displayTitle ?? escapeHtml(chapter.title)}</span></a></li>`
            )
            .join("\n          ")}
        </ul>
      </div>
    `.trim()
    )
    .join("\n")
}

function groupChaptersByVolume(
  chapters: ReadonlyArray<{
    id: string
    url: string
    title: string
    volumeLabel?: string
  }>,
  defaultVolumeLabel = "单话"
): SeriesPageChapterGroup[] {
  const groups = new Map<string, SeriesPageChapterGroup>()
  for (const chapter of chapters) {
    const label = chapter.volumeLabel ?? defaultVolumeLabel
    let group = groups.get(label)
    if (!group) {
      group = { volumeLabel: label, chapters: [] }
      groups.set(label, group)
    }
    group.chapters.push({
      id: chapter.id,
      url: chapter.url,
      title: chapter.title,
    })
  }
  return [...groups.values()]
}

function renderSeriesPageFrame(
  options: BuildSeriesPageHtmlOptions,
  chapterSection: string
): string {
  const metaOgImage = options.coverUrl
    ? `<meta property="og:image" content="${escapeHtml(options.coverUrl)}">`
    : ""
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(options.seriesTitle)} - 漫画柜</title>
  <meta property="og:title" content="${escapeHtml(options.seriesTitle)}">
  ${metaOgImage}
</head>
<body>
  <div class="book-cont">
    <div class="book-title">
      <h1>${escapeHtml(options.seriesTitle)}</h1>
    </div>
    ${options.coverUrl ? `<div class="hcover"><img src="${escapeHtml(options.coverUrl)}" alt="cover"></div>` : ""}
    <ul class="detail-list">
      <li><span></span></li>
      <li><span></span></li>
      <li><span></span></li>
      <li><span></span></li>
      <li><span>${options.author ? `<a>${escapeHtml(options.author)}</a>` : ""}</span></li>
      <li><span></span></li>
      <li><span></span></li>
      <li><span>${options.status ? escapeHtml(options.status) : ""}</span></li>
    </ul>
    ${options.description ? `<div id="intro-all">${escapeHtml(options.description)}</div>` : ""}
  </div>
  <div class="chapter cf mt16">
    ${chapterSection}
  </div>
</body>
</html>`
}

export function buildManhuaguiSeriesPageHtml(
  options: BuildSeriesPageHtmlOptions
): string {
  return renderSeriesPageFrame(options, renderChapterListBlocks(options.groups))
}

/**
 * Produce the adult-gated series page: warning banner plus an opaque
 * lz-string-compressed `#__VIEWSTATE` value that production does not decode.
 */
export function buildManhuaguiAdultSeriesPageHtml(
  options: BuildSeriesPageHtmlOptions
): string {
  const hiddenMarkup = `<div class="chapter">${renderChapterListBlocks(options.groups)}</div>`
  const compressedViewState = compressToBase64(hiddenMarkup)

  const gateFragment = `
  <div id="checkAdult">
    <p>本漫画包含敏感内容,请确认是否继续浏览</p>
  </div>
  <input id="__VIEWSTATE" value="${escapeHtml(compressedViewState)}">
  `

  return renderSeriesPageFrame(options, gateFragment)
}

export const BASIC_SERIES_PAGE_HTML = buildManhuaguiSeriesPageHtml({
  seriesId: BASIC_SERIES.series.seriesId,
  seriesTitle: BASIC_SERIES.series.seriesTitle,
  author: BASIC_SERIES.series.author,
  description: BASIC_SERIES.series.description,
  coverUrl: BASIC_SERIES.series.coverUrl,
  status: BASIC_SERIES.series.status,
  groups: groupChaptersByVolume(BASIC_CHAPTERS.chapters),
})

export const ADULT_SERIES_PAGE_HTML = buildManhuaguiAdultSeriesPageHtml({
  seriesId: ADULT_SERIES.series.seriesId,
  seriesTitle: ADULT_SERIES.series.seriesTitle,
  author: ADULT_SERIES.series.author,
  description: ADULT_SERIES.series.description,
  coverUrl: ADULT_SERIES.series.coverUrl,
  status: ADULT_SERIES.series.status,
  groups: groupChaptersByVolume(ADULT_CHAPTERS.chapters),
})

export const ADULT_UNGATED_SERIES_PAGE_HTML = buildManhuaguiSeriesPageHtml({
  seriesId: ADULT_SERIES.series.seriesId,
  seriesTitle: ADULT_SERIES.series.seriesTitle,
  author: ADULT_SERIES.series.author,
  description: ADULT_SERIES.series.description,
  coverUrl: ADULT_SERIES.series.coverUrl,
  status: ADULT_SERIES.series.status,
  groups: groupChaptersByVolume(ADULT_CHAPTERS.chapters),
})

export const MINIMAL_SERIES_PAGE_HTML = buildManhuaguiSeriesPageHtml({
  seriesId: MINIMAL_SERIES.series.seriesId,
  seriesTitle: MINIMAL_SERIES.series.seriesTitle,
  status: MINIMAL_SERIES.series.status,
  groups: groupChaptersByVolume(SMALL_SERIES.chapters),
})

export const CATEGORY_SERIES_PAGE_HTML = buildManhuaguiSeriesPageHtml({
  seriesId: CATEGORY_SERIES.series.seriesId,
  seriesTitle: CATEGORY_SERIES.series.seriesTitle,
  author: CATEGORY_SERIES.series.author,
  description: CATEGORY_SERIES.series.description,
  coverUrl: CATEGORY_SERIES.series.coverUrl,
  status: CATEGORY_SERIES.series.status,
  groups: groupChaptersByVolume(CATEGORY_CHAPTERS.chapters),
})

export const KIMETSU_SERIES_PAGE_HTML = readFileSync(
  "tests/fixtures/site-integrations/readmanga/series.html",
  "utf8"
)

export const KIMETSU_EXTRA_READER_HTML = readFileSync(
  "tests/fixtures/site-integrations/readmanga/reader.html",
  "utf8"
)

export const HOME_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>漫画柜</title></head>
<body><main>Manhuagui Home</main></body>
</html>`

interface BuildChapterPageHtmlOptions {
  seriesId: string
  chapterId: string
  files?: string[]
}

/** Return the captured representative reader or build one with packed image data. */
export function buildManhuaguiChapterPageHtml(
  options: BuildChapterPageHtmlOptions
): string {
  if (
    options.seriesId === "19430" &&
    options.chapterId === "494877" &&
    !options.files
  ) {
    return KIMETSU_EXTRA_READER_HTML
  }
  const files = options.files ?? buildManhuaguiImageFilenames()
  const imgData: ManhuaguiPackedImageData = {
    path: buildManhuaguiChapterPathSegment(options.seriesId, options.chapterId),
    files,
    sl: buildManhuaguiChapterSlMetadata(options.chapterId),
  }
  const packedScript = buildManhuaguiPackedPayloadScript(imgData)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Manhuagui Chapter ${escapeHtml(options.chapterId)}</title>
  <script src="${escapeHtml(MANHUAGUI_CONFIG_SCRIPT_URL)}"></script>
</head>
<body>
  <div id="mangaBox"></div>
  <script>${packedScript}</script>
</body>
</html>`
}
