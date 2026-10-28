import { createSignedReaderOffscreen } from "../animemangahouse/protocol/offscreen"
import { mangabzSite } from "./contracts"

export const offscreenSiteAdapter = createSignedReaderOffscreen(mangabzSite)
