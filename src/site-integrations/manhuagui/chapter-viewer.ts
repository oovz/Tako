import { decompressFromBase64 } from "./lz-string"
import {
  fetchReaderConfig,
  selectReaderHost,
  type ReaderConfig,
} from "./reader-config"
import type { EffectivePolicy } from "@/src/runtime/rate-limit"
import { ProviderContractError } from "../provider-contract-error"
import { DEFAULT_IMAGE_PROTOCOL, isAllowedManhuaguiImageUrl } from "./shared"
import { sanitizeLabel } from "@/src/shared/site-integration-utils"

/**
 * The subset of `SMH.imgData({...})` fields the viewer URL builder consumes.
 * - `files`: image filenames in reading order
 * - `path`: hamreus.com base path (or absolute URL) for the chapter directory
 * - `sl`: `{ e: expiryEpoch, m: signature }` used for the signed query string
 */
type PackedImageData = {
  files?: unknown
  path?: unknown
  sl?: {
    e?: unknown
    m?: unknown
  }
}

/**
 * Raw P.A.C.K.E.R. payload tuple extracted from the chapter HTML before
 * dictionary substitution. `template` is the compressed JavaScript literal,
 * `radix` and `count` are the base and dictionary length, and `rawKeys` is the
 * base64 lz-string-compressed `|`-separated dictionary body.
 */
type PackedPayloadTemplate = {
  template: string
  radix: number
  count: number
  rawKeys: string
}

// Matches the `window["eval"]((function(p,a,c,k,e,d){...}('<template>',<radix>,<count>,'<keys>'.split('|'),0,{}))`
// unpacker invocation Manhuagui's chapter viewer emits. The capture order is
// carefully aligned with `extractPackedPayloadTemplate` below.
const PACKED_PAYLOAD_REGEX =
  /window\[[^\]]+\]\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\[[\s\S]*?\]\([\s\S]*?\),0,\{\}\)\)/s

const MAX_CHAPTER_HTML_LENGTH = 10 * 1024 * 1024
const MAX_PACKED_TEMPLATE_LENGTH = 2 * 1024 * 1024
const MAX_PACKED_KEYS_LENGTH = 1024 * 1024
const MAX_PACKED_DICTIONARY_SIZE = 10_000
const MAX_IMAGE_FILES = 5_000

// Markers present in the age-warning HTML Manhuagui serves when the
// `isAdult=1` cookie is missing. Used to distinguish "format changed" from
// "site consent not completed" so bug reports point at the right cause.
const AGE_GATE_MARKERS = [
  'id="checkAdult"',
  "id='checkAdult'",
  "showAdultInfo()",
  "isAdult=1",
]

/**
 * Decode escape sequences present in a JavaScript single-quoted string
 * literal (`\xNN`, `\uNNNN`, `\"`, `\'`, `\\`). Used before template
 * substitution so byte-for-byte content survives the regex capture.
 */
function decodeJavaScriptStringLiteral(value: string): string {
  return value
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\")
}

function isAgeGatedChapterHtml(chapterHtml: string): boolean {
  return AGE_GATE_MARKERS.some((marker) => chapterHtml.includes(marker))
}

function extractPackedPayloadTemplate(
  chapterHtml: string
): PackedPayloadTemplate {
  if (chapterHtml.length > MAX_CHAPTER_HTML_LENGTH) {
    throw new Error("Manhuagui chapter HTML exceeds the supported size")
  }
  const packedMatch = chapterHtml.match(PACKED_PAYLOAD_REGEX)
  if (!packedMatch) {
    if (isAgeGatedChapterHtml(chapterHtml)) {
      throw new Error(
        "Manhuagui age-gate not completed: open the chapter on Manhuagui, complete the site consent prompt, and reload before downloading."
      )
    }
    throw new Error(
      "Manhuagui viewer format changed (packed image data missing)"
    )
  }

  const [, templateLiteral, radixText, countText, rawKeys] = packedMatch
  if (!templateLiteral || !radixText || !countText || rawKeys == null) {
    throw new Error(
      "Manhuagui viewer format changed (packed image data incomplete)"
    )
  }

  const template = decodeJavaScriptStringLiteral(templateLiteral)
  const radix = Number.parseInt(radixText, 10)
  const count = Number.parseInt(countText, 10)
  if (radix < 2 || radix > 62) {
    throw new Error("Manhuagui packed radix is out of bounds")
  }
  if (count < 0 || count > MAX_PACKED_DICTIONARY_SIZE) {
    throw new Error("Manhuagui packed dictionary size is out of bounds")
  }
  if (
    template.length > MAX_PACKED_TEMPLATE_LENGTH ||
    rawKeys.length > MAX_PACKED_KEYS_LENGTH
  ) {
    throw new Error("Manhuagui packed payload exceeds the supported size")
  }

  return {
    template,
    radix,
    count,
    rawKeys,
  }
}

/**
 * Walk the unpacked JavaScript source and slice out the first balanced JSON
 * object that immediately follows `marker` (e.g. `imgData(`). Needed because
 * the template is a JS expression and we cannot use `JSON.parse` on the whole
 * body.
 */
function extractBalancedJsonObject(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker)
  if (markerIndex < 0) {
    throw new Error("Manhuagui viewer format changed (imgData call missing)")
  }

  const startIndex = source.indexOf("{", markerIndex + marker.length)
  if (startIndex < 0) {
    throw new Error("Manhuagui viewer format changed (imgData payload missing)")
  }

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index]
    if (!char) {
      continue
    }

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }

      if (char === "\\") {
        escaped = true
        continue
      }

      if (char === '"') {
        inString = false
      }

      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === "{") {
      depth += 1
      continue
    }

    if (char !== "}") {
      continue
    }

    depth -= 1
    if (depth === 0) {
      return source.slice(startIndex, index + 1)
    }
  }

  throw new Error(
    "Manhuagui viewer format changed (imgData payload unbalanced)"
  )
}

/**
 * Reverse the P.A.C.K.E.R. substitution by rebuilding the dictionary from
 * `rawKeys` (lz-string base64) and replacing every `\w+` token in the
 * template, then slicing out the `imgData({...})` argument as JSON.
 */
function parsePackedPayloadTemplate(
  template: string,
  radix: number,
  count: number,
  rawKeys: string
): PackedImageData {
  const keyText = decompressFromBase64(rawKeys)
  if (keyText == null) {
    throw new Error("Unable to decompress packed image payload")
  }

  const keys = keyText.split("|")
  const dictionary: Record<string, string> = {}

  const encodeIndex = (value: number): string => {
    const prefix = value < radix ? "" : encodeIndex(Math.floor(value / radix))
    const remainder = value % radix
    const suffix =
      remainder > 35
        ? String.fromCharCode(remainder + 29)
        : remainder.toString(36)
    return `${prefix}${suffix}`
  }

  for (let index = count - 1; index >= 0; index -= 1) {
    const key = encodeIndex(index)
    dictionary[key] = keys[index] || key
  }

  const jsonText = template.replace(
    /\b\w+\b/g,
    (token) => dictionary[token] ?? token
  )
  const parsed: unknown = JSON.parse(
    extractBalancedJsonObject(jsonText, "imgData(")
  )
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid Manhuagui packed image data: expected JSON object")
  }
  return parsed
}

function parsePackedImageData(chapterHtml: string): PackedImageData {
  const packedTemplate = extractPackedPayloadTemplate(chapterHtml)
  return parsePackedPayloadTemplate(
    packedTemplate.template,
    packedTemplate.radix,
    packedTemplate.count,
    packedTemplate.rawKeys
  )
}

function normalizeImagePath(path: string): string {
  const cleaned = sanitizeLabel(path).replace(/^\/+/, "")
  if (!cleaned) {
    throw new Error("Manhuagui viewer format changed (image path missing)")
  }

  return cleaned
}

/**
 * Produce the directory-level base URL an image filename is appended to,
 * honoring any absolute `path` the packed data supplies and otherwise
 * selecting a `{host}.hamreus.com` base from the reader config.
 */
function buildReaderFilePath(
  basePath: string,
  readerConfig: ReaderConfig
): string {
  const normalizedPath = sanitizeLabel(basePath)
  if (!normalizedPath) {
    throw new Error("Manhuagui viewer format changed (image path missing)")
  }

  if (/^https?:\/\//i.test(normalizedPath)) {
    const absoluteUrl = normalizedPath.endsWith("/")
      ? normalizedPath
      : `${normalizedPath}/`
    if (!isAllowedManhuaguiImageUrl(absoluteUrl)) {
      throw new Error("Manhuagui image URL origin is not allowed")
    }
    return absoluteUrl
  }

  if (normalizedPath.startsWith("//")) {
    const absoluteUrl = `${DEFAULT_IMAGE_PROTOCOL}${normalizedPath}`
    if (!isAllowedManhuaguiImageUrl(absoluteUrl)) {
      throw new Error("Manhuagui image URL origin is not allowed")
    }
    return absoluteUrl.endsWith("/") ? absoluteUrl : `${absoluteUrl}/`
  }

  const hostName = selectReaderHost(readerConfig)
  return `${DEFAULT_IMAGE_PROTOCOL}//${hostName}.hamreus.com/${normalizeImagePath(normalizedPath).replace(/\/?$/, "/")}`
}

function buildImageUrl(
  basePath: string,
  filename: string,
  expiresAt: string,
  signature: string
): string {
  const normalizedFilename = sanitizeLabel(filename)
  if (!normalizedFilename) {
    throw new Error("Manhuagui viewer format changed (image filename missing)")
  }

  const normalizedBasePath = basePath.endsWith("/") ? basePath : `${basePath}/`
  return `${normalizedBasePath}${normalizedFilename}?e=${encodeURIComponent(expiresAt)}&m=${encodeURIComponent(signature)}`
}

function extractImageUrlsFromPackedData(
  data: PackedImageData,
  readerConfig: ReaderConfig
): string[] {
  const files = Array.isArray(data.files)
    ? data.files.filter(
        (value): value is string =>
          typeof value === "string" && sanitizeLabel(value).length > 0
      )
    : []
  if (files.length > MAX_IMAGE_FILES) {
    throw new Error("Manhuagui image file count exceeds the supported limit")
  }
  const basePath =
    typeof data.path === "string"
      ? buildReaderFilePath(data.path, readerConfig)
      : ""
  const expiresAt =
    typeof data.sl?.e === "string" || typeof data.sl?.e === "number"
      ? String(data.sl.e)
      : ""
  const signature =
    typeof data.sl?.m === "string" || typeof data.sl?.m === "number"
      ? String(data.sl.m)
      : ""

  if (!basePath || !expiresAt || !signature || files.length === 0) {
    throw new Error(
      "Manhuagui viewer format changed (image metadata incomplete)"
    )
  }

  return files.map((filename) => {
    const imageUrl = buildImageUrl(basePath, filename, expiresAt, signature)
    if (!isAllowedManhuaguiImageUrl(imageUrl)) {
      throw new Error("Manhuagui image URL origin is not allowed")
    }
    return imageUrl
  })
}

/**
 * Convert chapter viewer HTML into the ordered list of signed image URLs.
 *
 * Two fetches are issued concurrently: the packed payload is decoded locally
 * (synchronous) while the external `config_*.js` is fetched to determine the
 * image host. Config failures are surfaced rather than replaced with a stale
 * host map.
 */
export async function resolveImageUrlsFromChapterHtml(
  chapterHtml: string,
  chapterPolicy?: EffectivePolicy
): Promise<string[]> {
  try {
    const [packedImageData, readerConfig] = await Promise.all([
      Promise.resolve(parsePackedImageData(chapterHtml)),
      fetchReaderConfig(chapterHtml, chapterPolicy),
    ])

    return extractImageUrlsFromPackedData(packedImageData, readerConfig)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      error instanceof SyntaxError ||
      message.includes("format changed") ||
      message.includes("config script missing") ||
      message.includes("packed image") ||
      message.includes("decompress packed")
    ) {
      throw new ProviderContractError(
        "Manhuagui viewer data no longer matches the supported format.",
        error
      )
    }
    throw error
  }
}
