/** Manhuagui reader configuration and packed image-payload fixtures. */

import { compressToBase64 } from "../../../../../shared/manhuagui-compress"
import { MANHUAGUI_CONFIG_SCRIPT_DOMAIN } from "../../../test-domains-constants"

/**
 * URL path the mock serves the reader-config script at. Matches the regex
 * `chapter-viewer` uses: `<script src=".../scripts/config_*.js">`.
 */
export const MANHUAGUI_CONFIG_SCRIPT_PATH = "/scripts/config_16.js"
export const MANHUAGUI_CONFIG_SCRIPT_URL = `https://${MANHUAGUI_CONFIG_SCRIPT_DOMAIN}${MANHUAGUI_CONFIG_SCRIPT_PATH}`

/** Image host declared by the mock reader configuration. */
export const MANHUAGUI_MOCK_IMAGE_HOST = "i"
export const MANHUAGUI_MOCK_IMAGE_DOMAIN = `${MANHUAGUI_MOCK_IMAGE_HOST}.hamreus.com`

/** Reader configuration with one image host. */
export function buildManhuaguiReaderConfigScript(): string {
  return `;var _cfg={curServ:0,curHost:0,picserv:[{name:"自动",hosts:[{h:"${MANHUAGUI_MOCK_IMAGE_HOST}",w:1}]}]};`
}

export interface ManhuaguiPackedImageData {
  path: string
  files: string[]
  sl: {
    e: string
    m: string
  }
}

/**
 * The unpacker requires a nonempty compressed dictionary. This unused token
 * preserves the supplied JSON during dictionary substitution.
 */
const MANHUAGUI_UNUSED_PACKED_TOKEN = "zzzmockdictzzz"

/** Build a packed reader script containing the supplied image data. */
export function buildManhuaguiPackedPayloadScript(
  imgData: ManhuaguiPackedImageData
): string {
  const jsonPayload = JSON.stringify(imgData)
  const template = `SMH.imgData(${jsonPayload}).preInit()`
  const rawKeys = compressToBase64(MANHUAGUI_UNUSED_PACKED_TOKEN)
  return `window["eval"](function(p,a,c,k,e,d){return p}('${template}',10,1,'${rawKeys}'['split']('|'),0,{}))`
}

/** Synthetic expiry and signature values; the mock image host does not verify them. */
export function buildManhuaguiChapterSlMetadata(chapterId: string): {
  e: string
  m: string
} {
  return {
    // Epoch in the distant future so no downstream validator ever treats
    // the URL as expired.
    e: "9999999999",
    m: `mock-sig-${chapterId}`,
  }
}

/**
 * Base path segment the signed image URL resolves against. Manhuagui's
 * real paths look like `ps1/f/comic/{series}/{chapter}_SOMETHING/`; the
 * mock mirrors that structure so the production path normalizer has a
 * realistic input to sanitize.
 */
export function buildManhuaguiChapterPathSegment(
  seriesId: string,
  chapterId: string
): string {
  return `/ps1/f/mock/${seriesId}/${chapterId}/`
}
