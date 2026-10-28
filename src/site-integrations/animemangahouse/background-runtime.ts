import { createSignedReaderBackground } from "./protocol/background"
import { dm5Site } from "./contracts"

export const backgroundSiteAdapter = createSignedReaderBackground(dm5Site)
