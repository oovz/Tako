import { createManganatoOffscreenAdapter } from "../manganato/reader/offscreen"
import { MANGAKAKALOT_SITE } from "./contracts/site"

export const offscreenSiteAdapter =
  createManganatoOffscreenAdapter(MANGAKAKALOT_SITE)
