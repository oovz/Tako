import { createSignedReaderBackground } from "../animemangahouse/protocol/background"
import { mangabzSite } from "./contracts"

export const backgroundSiteAdapter = createSignedReaderBackground(mangabzSite)
