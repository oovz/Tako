import type { SignedReaderSite } from "../protocol/series"

export const dm5Site: SignedReaderSite = {
  id: "animemangahouse",
  name: "DM5",
  origin: "https://www.dm5.com",
  prefix: "DM5",
  chapterEndpoint: "chapterfun.ashx",
  seriesPath: /^\/manhua-[^/]+\/$/,
  imageHosts: ["cdndm5.com"],
}
