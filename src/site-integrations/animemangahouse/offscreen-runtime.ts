import { createSignedReaderOffscreen } from "./protocol/offscreen"
import { dm5Site } from "./contracts"

// DM5's CDN rejects a site-root Referer. The session rule in definition.json
// supplies a reader route instead.
export const offscreenSiteAdapter = createSignedReaderOffscreen(dm5Site)
