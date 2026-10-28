import { createManganatoBrowserFixture } from "../manganato/routes"

export const mangakakalotFixture = createManganatoBrowserFixture(
  "mangakakalot",
  "mangakakalove.com",
  9984
)
export const registerMangakakalotRoutes = mangakakalotFixture.registerRoutes
export const registerMangakakalotLocalServerHandlers =
  mangakakalotFixture.registerLocalServerHandlers
