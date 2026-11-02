import { createManganatoBackgroundAdapter } from "./reader/background"
import { MANGANATO_SITE } from "./contracts/site"

export const backgroundSiteAdapter =
  createManganatoBackgroundAdapter(MANGANATO_SITE)
