import { MAX_CHAPTER_IMAGES } from "@/src/constants/timeouts"
import { ProviderContractError } from "../../provider-contract-error"
import type { SignedReaderSite } from "./series"

function invalid(): never {
  throw new ProviderContractError(
    "Signed reader data no longer matches the supported format"
  )
}

function decodeLiteral(raw: string): string {
  return raw.replace(
    /\\(x[\da-fA-F]{2}|u[\da-fA-F]{4}|[\\'"/bfnrtv])/g,
    (_, escape: string) => {
      if (escape[0] === "x" || escape[0] === "u")
        return String.fromCharCode(Number.parseInt(escape.slice(1), 16))
      const escapes: Record<string, string> = {
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
        v: "\v",
      }
      return escapes[escape] ?? escape
    }
  )
}

function encodedWord(value: number, radix: number): string {
  const alphabet =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
  let result = ""
  do {
    result = alphabet[value % radix] + result
    value = Math.floor(value / radix)
  } while (value > 0)
  return result
}

/** Decode the sites' packed data by dictionary substitution; no site code executes. */
function packedResponseParts(script: string) {
  if (script.length > 1024 * 1024) invalid()
  const match = script.match(
    /\}\('((?:\\.|[^'\\])*)',(\d+),(\d+),'((?:\\.|[^'\\])*)'\.split\('\|'\),0,\{\}\)\)/
  )
  if (!match) invalid()
  const radix = Number(match[2]),
    count = Number(match[3])
  if (radix < 2 || radix > 62 || count < 1 || count > 4096) invalid()
  const dictionary = decodeLiteral(match[4]).split("|")
  if (dictionary.length !== count) invalid()
  return { dictionary, radix, template: decodeLiteral(match[1]) }
}

function unpackResponse(script: string): string {
  const { dictionary, radix, template } = packedResponseParts(script)
  const replacements = new Map<string, string>()
  dictionary.forEach((word, index) => {
    if (word) replacements.set(encodedWord(index, radix), word)
  })
  let outputLength = template.length
  const decoded = template.replace(/\b\w+\b/g, (word) => {
    const replacement = replacements.get(word) ?? word
    outputLength += replacement.length - word.length
    if (outputLength > 4 * 1024 * 1024) invalid()
    return replacement
  })
  if (decoded.length > 4 * 1024 * 1024) invalid()
  return decoded
}

function literalAssignment(source: string, name: string): string {
  const match = source.match(
    new RegExp(`\\b${name}\\s*=\\s*(["'])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`)
  )
  if (!match) invalid()
  return decodeLiteral(match[2])
}

export function assertImageUrl(site: SignedReaderSite, value: string): URL {
  const url = new URL(value)
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !site.imageHosts.some(
      (host) =>
        url.hostname === host ||
        (host === "cdndm5.com" && url.hostname.endsWith(`.${host}`))
    )
  ) {
    throw new ProviderContractError(`${site.name} image origin is not allowed`)
  }
  return url
}

function readImageValues(array: string): string[] {
  const values: string[] = []
  let remainder = array
  const itemPattern = /^\s*(["'])((?:\\.|(?!\1)[^\\])*)\1\s*(,|$)/
  while (remainder.length) {
    const item = remainder.match(itemPattern)
    if (!item) invalid()
    values.push(decodeLiteral(item[2]))
    remainder = remainder.slice(item[0].length)
    if (values.length > MAX_CHAPTER_IMAGES) invalid()
  }
  return values
}

function assertImageMode(
  site: SignedReaderSite,
  script: string,
  decoded: string
): void {
  if (/\bd_c\s*=/.test(decoded) || /\bd_c\s*=/.test(script))
    throw new ProviderContractError(
      `${site.name} reader reports an unavailable error image`
    )
  if (/\bhd_c\s*=/.test(decoded))
    throw new ProviderContractError(
      `${site.name} alternate reader image mode is unsupported`
    )
}

export function readSignedImageResponse(
  site: SignedReaderSite,
  script: string
): string[] {
  const decoded = unpackResponse(script)
  assertImageMode(site, script, decoded)
  const base = literalAssignment(decoded, "pix")
  const array = decoded.match(/\bpvalue\s*=\s*\[([^\]]*)\]/)?.[1]
  if (array === undefined) invalid()
  const values = readImageValues(array)
  const suffix = decoded.match(
    /pvalue\[i\]\s*=\s*pix\s*\+\s*pvalue\[i\]\s*\+\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/
  )?.[2]
  if (suffix === undefined || values.length === 0) invalid()
  return values.map(
    (value) =>
      assertImageUrl(
        site,
        /^(https?:)?\/\//.test(value)
          ? new URL(value, "https:").href
          : base + value + decodeLiteral(suffix)
      ).href
  )
}

function assertSigningFields(sign: string, date: string): void {
  if (!sign || !date || sign.length > 256 || date.length > 128) invalid()
}

function readReaderKey(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html")
  const key =
    document
      .querySelector<HTMLInputElement>("#dm5_key")
      ?.getAttribute("value") ?? ""
  if (key.length > 1024) invalid()
  return key
}

export function readReaderConfiguration(
  site: SignedReaderSite,
  html: string,
  chapterId: string
): {
  mid: string
  cid: string
  count: number
  sign: string
  date: string
  key: string
} {
  const number = (name: string) =>
    html.match(new RegExp(`\\b${site.prefix}_${name}\\s*=\\s*(\\d+)`))?.[1]
  const cid = number("CID"),
    mid = number("MID"),
    count = Number(number("IMAGE_COUNT"))
  if (cid !== chapterId || !mid)
    throw new ProviderContractError(
      `${site.name} reader identity does not match the selected chapter`
    )
  if (!Number.isInteger(count) || count < 1 || count > MAX_CHAPTER_IMAGES)
    throw new ProviderContractError(
      `${site.name} reader page count is unavailable or exceeds the supported limit`
    )
  const sign = literalAssignment(html, `${site.prefix}_VIEWSIGN`),
    date = literalAssignment(html, `${site.prefix}_VIEWSIGN_DT`)
  assertSigningFields(sign, date)
  const key = readReaderKey(html)
  return { cid, mid, count, sign, date, key }
}
