import { readFileSync } from "node:fs"
import { resolve } from "node:path"

export const BASIC_SERIES_PAGE_HTML = readFileSync(
  resolve("tests/fixtures/site-integrations/mangamillion/series-page.html"),
  "utf8"
)

// Unsupported landing context used only to exercise navigation reset.
export const HOME_PAGE_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>MANGA MILLION</title></head><body></body></html>'
