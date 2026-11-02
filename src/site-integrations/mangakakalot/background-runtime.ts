import { createManganatoBackgroundAdapter } from "../manganato/reader/background"
import { MANGAKAKALOT_SITE } from "./contracts/site"

export const backgroundSiteAdapter =
  createManganatoBackgroundAdapter(MANGAKAKALOT_SITE)
