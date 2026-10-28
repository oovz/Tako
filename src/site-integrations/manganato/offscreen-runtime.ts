import { createManganatoOffscreenAdapter } from "./reader/offscreen"
import { MANGANATO_SITE } from "./contracts/site"

export const offscreenSiteAdapter =
  createManganatoOffscreenAdapter(MANGANATO_SITE)
