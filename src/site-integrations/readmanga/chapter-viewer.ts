import { decompressFromBase64 } from "./lz-string"
import {
  fetchReaderConfig,
  selectReaderHost,
  type ReaderConfig,
} from "./reader-config"
import type {
  EffectivePolicy,
  RateLimitService,
} from "@/src/runtime/rate-limit"
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
    throw new ProviderContractError(
      "Manhuagui chapter HTML exceeds the supported size"
    )
  }
  const packedMatch = chapterHtml.match(PACKED_PAYLOAD_REGEX)
  if (!packedMatch) {
    if (isAgeGatedChapterHtml(chapterHtml)) {
      throw new ProviderContractError(
        "Manhuagui age-gate not completed: open the chapter on Manhuagui, complete the site consent prompt, and reload before downloading."
      )
    }
    throw new ProviderContractError(
      "Manhuagui viewer data no longer matches the supported format."
    )
  }

  return readPackedPayloadFields(packedMatch)
}

function readPackedPayloadFields(
  packedMatch: RegExpMatchArray
): PackedPayloadTemplate {
  const [, templateLiteral, radixText, countText, rawKeys] = packedMatch
  if (!templateLiteral || !radixText || !countText || rawKeys == null) {
    throw new ProviderContractError(
      "Manhuagui viewer data no longer matches the supported format."
    )
  }

  const payload = {
    template: decodeJavaScriptStringLiteral(templateLiteral),
    radix: Number.parseInt(radixText, 10),
    count: Number.parseInt(countText, 10),
    rawKeys,
  }
  assertPackedPayloadBounds(payload)
  return payload
}

function assertPackedPayloadBounds(payload: PackedPayloadTemplate): void {
  if (payload.radix < 2 || payload.radix > 62) {
    throw new ProviderContractError("Manhuagui packed radix is out of bounds")
  }
  if (payload.count < 0 || payload.count > MAX_PACKED_DICTIONARY_SIZE) {
    throw new ProviderContractError(
      "Manhuagui packed dictionary size is out of bounds"
    )
  }
  if (
    payload.template.length > MAX_PACKED_TEMPLATE_LENGTH ||
    payload.rawKeys.length > MAX_PACKED_KEYS_LENGTH
  ) {
    throw new ProviderContractError(
      "Manhuagui packed payload exceeds the supported size"
    )
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
    throw new ProviderContractError(
      "Manhuagui viewer data no longer matches the supported format."
    )
  }

  const startIndex = source.indexOf("{", markerIndex + marker.length)
  if (startIndex < 0) {
    throw new ProviderContractError(
      "Manhuagui viewer data no longer matches the supported format."
    )
  }

  let depth = 0
  const stringState = { inString: false, escaped: false }

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index]
    if (consumeJsonStringCharacter(stringState, char)) continue
    if (char === "{") {
      depth += 1
    } else if (char === "}") {
      depth -= 1
      if (depth === 0) return source.slice(startIndex, index + 1)
    }
  }

  throw new ProviderContractError(
    "Manhuagui viewer data no longer matches the supported format."
  )
}

function consumeJsonStringCharacter(
  state: { inString: boolean; escaped: boolean },
  char: string
): boolean {
  if (state.inString) {
    if (state.escaped) state.escaped = false
    else if (char === "\\") state.escaped = true
    else if (char === '"') state.inString = false
    return true
  }
  if (char === '"') {
    state.inString = true
    return true
  }
  return false
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
    throw new ProviderContractError(
      "Manhuagui viewer data no longer matches the supported format."
    )
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
    throw new ProviderContractError(
      "Manhuagui viewer data no longer matches the supported format."
    )
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
    throw new ProviderContractError(
      "Manhuagui viewer data no longer matches the supported format."
    )
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
    throw new ProviderContractError(
      "Manhuagui viewer data no longer matches the supported format."
    )
  }

  const absoluteUrl = resolveAbsoluteReaderPath(normalizedPath)
  if (absoluteUrl) return absoluteUrl

  const hostName = selectChapterReaderHost(readerConfig)
  return `${DEFAULT_IMAGE_PROTOCOL}//${hostName}.hamreus.com/${normalizeImagePath(normalizedPath).replace(/\/?$/, "/")}`
}

function resolveAbsoluteReaderPath(path: string): string | undefined {
  let absoluteUrl: string
  if (/^https?:\/\//i.test(path)) absoluteUrl = path
  else if (path.startsWith("//"))
    absoluteUrl = `${DEFAULT_IMAGE_PROTOCOL}${path}`
  else return undefined

  if (!isAllowedManhuaguiImageUrl(absoluteUrl)) {
    throw new ProviderContractError("Manhuagui image URL origin is not allowed")
  }
  return absoluteUrl.endsWith("/") ? absoluteUrl : `${absoluteUrl}/`
}

function selectChapterReaderHost(readerConfig: ReaderConfig): string {
  try {
    return selectReaderHost(readerConfig)
  } catch (error) {
    if (error instanceof ProviderContractError) {
      throw new ProviderContractError(
        "Manhuagui viewer data no longer matches the supported format.",
        error
      )
    }
    throw error
  }
}

function buildImageUrl(
  basePath: string,
  filename: string,
  expiresAt: string,
  signature: string
): string {
  const normalizedFilename = sanitizeLabel(filename)
  if (!normalizedFilename) {
    throw new ProviderContractError(
      "Manhuagui viewer data no longer matches the supported format."
    )
  }

  const normalizedBasePath = basePath.endsWith("/") ? basePath : `${basePath}/`
  return `${normalizedBasePath}${normalizedFilename}?e=${encodeURIComponent(expiresAt)}&m=${encodeURIComponent(signature)}`
}

function readImageFiles(files: unknown): string[] {
  if (!Array.isArray(files) || files.length === 0) {
    throw new ProviderContractError(
      "Manhuagui viewer data no longer matches the supported format."
    )
  }
  if (files.length > MAX_IMAGE_FILES) {
    throw new ProviderContractError(
      "Manhuagui image file count exceeds the supported limit"
    )
  }
  return files.map((value) => {
    if (typeof value !== "string" || sanitizeLabel(value).length === 0) {
      throw new ProviderContractError(
        "Manhuagui viewer data contains an invalid image filename."
      )
    }
    return value
  })
}

function readSignatureValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : ""
}

function readSignedImageDirectory(
  data: PackedImageData,
  readerConfig: ReaderConfig
) {
  const basePath =
    typeof data.path === "string"
      ? buildReaderFilePath(data.path, readerConfig)
      : ""
  const expiresAt = readSignatureValue(data.sl?.e)
  const signature = readSignatureValue(data.sl?.m)
  if (!basePath || !expiresAt || !signature) {
    throw new ProviderContractError(
      "Manhuagui viewer data no longer matches the supported format."
    )
  }
  return { basePath, expiresAt, signature }
}

function extractImageUrlsFromPackedData(
  data: PackedImageData,
  readerConfig: ReaderConfig
): string[] {
  const files = readImageFiles(data.files)
  const { basePath, expiresAt, signature } = readSignedImageDirectory(
    data,
    readerConfig
  )
  return files.map((filename) => {
    const imageUrl = buildImageUrl(basePath, filename, expiresAt, signature)
    if (!isAllowedManhuaguiImageUrl(imageUrl)) {
      throw new ProviderContractError(
        "Manhuagui image URL origin is not allowed"
      )
    }
    return imageUrl
  })
}

/**
 * Combine locally decoded viewer data with the fetched reader configuration
 * to produce signed image URLs in reading order.
 */
export async function buildManhuaguiChapterImageUrlsFromHtml(
  chapterHtml: string,
  rateLimitService: RateLimitService,
  chapterPolicy?: EffectivePolicy,
  signal?: AbortSignal
): Promise<string[]> {
  try {
    const [packedImageData, readerConfig] = await Promise.all([
      Promise.resolve(parsePackedImageData(chapterHtml)),
      fetchReaderConfig(chapterHtml, rateLimitService, chapterPolicy, signal),
    ])

    return extractImageUrlsFromPackedData(packedImageData, readerConfig)
  } catch (error) {
    if (error instanceof ProviderContractError) {
      throw error
    }
    if (error instanceof SyntaxError) {
      throw new ProviderContractError(
        "Manhuagui viewer data no longer matches the supported format.",
        error
      )
    }
    throw error
  }
}
