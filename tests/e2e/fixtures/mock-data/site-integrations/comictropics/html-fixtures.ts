import { readFileSync } from "node:fs"
import { resolve } from "node:path"

export const SERIES_PAGE_HTML = Object.fromEntries(
  [1, 2, 3].map((page) => [
    page,
    readFileSync(
      resolve(
        `tests/fixtures/site-integrations/comictropics/series-page-${page}.html`
      ),
      "utf8"
    ),
  ])
)
export const BASIC_SERIES_PAGE_HTML = SERIES_PAGE_HTML[1]!

// Unsupported landing context used only to exercise navigation reset.
export const HOME_PAGE_HTML =
  '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>COMIC熱帯</title></head><body></body></html>'
