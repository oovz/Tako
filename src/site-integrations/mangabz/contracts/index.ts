import type { SignedReaderSite } from "../../animemangahouse/protocol/series"

export const mangabzSite: SignedReaderSite = {
  id: "mangabz",
  name: "Mangabz",
  origin: "https://www.mangabz.com",
  prefix: "MANGABZ",
  chapterEndpoint: "chapterimage.ashx",
  seriesPath: /^\/\d+bz\/$/,
  imageHosts: ["image.mangabz.com", "cover.mangabz.com"],
}
