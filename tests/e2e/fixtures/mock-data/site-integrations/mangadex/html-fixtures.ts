/** Stripped public DOM from the supplied Hunter x Hunter capture. */
import { readFileSync } from "node:fs"
import type { HTMLFixtures } from "../../types"

export const SERIES_PAGE_HTML = readFileSync(
  new URL(
    "../../../../../../tests/fixtures/site-integrations/mangadex/series-page.html",
    import.meta.url
  ),
  "utf8"
)
export const CHAPTER_PAGE_HTML = readFileSync(
  new URL(
    "../../../../../../tests/fixtures/site-integrations/mangadex/reader.html",
    import.meta.url
  ),
  "utf8"
)

/** The API-driven adapter does not require a separate minimal DOM. */
export const MINIMAL_SERIES_PAGE_HTML = SERIES_PAGE_HTML
export const MANGADEX_HTML: HTMLFixtures = {
  seriesPageHtml: SERIES_PAGE_HTML,
  chapterPageHtml: CHAPTER_PAGE_HTML,
}
export const MANGADEX_MINIMAL_HTML = MANGADEX_HTML
