import type { MangaHerePackedReaderData } from "./contracts/reader"
import { MAX_CHAPTER_IMAGES } from "@/src/constants/timeouts"
import { ProviderContractError } from "../provider-contract-error"

export const MANGAHERE_ORIGIN = "https://newm.mangahere.cc"

export function mangaHereUrl(value: string): URL {
  const url = new URL(value)
  if (
    url.protocol !== "https:" ||
    url.hostname !== "newm.mangahere.cc" ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new ProviderContractError("MangaHere page origin is not allowed")
  }
  return url
}

export function mangaHereImage(value: string): string {
  const url = new URL(value, MANGAHERE_ORIGIN)
  if (
    url.protocol !== "https:" ||
    !["zjcdn.mangahere.org", "fmcdn.mangahere.com"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    !url.pathname.startsWith("/store/manga/")
  ) {
    throw new ProviderContractError(
      "MangaHere image URL is unavailable or unsupported"
    )
  }
  return url.href
}

function unpackString(value: string): string {
  return value.replace(/\\([\\'"])/g, "$1")
}

export function parseMangaHerePackedImages(html: string): string[] {
  if (html.length > 10_000_000)
    throw new ProviderContractError(
      "MangaHere reader exceeds the supported size"
    )
  const tuple = html.match(
    /\}\('((?:\\.|[^'\\])*)',(\d+),(\d+),'((?:\\.|[^'\\])*)'\.split\('\|'\),0,\{\}\)\)/
  )
  if (!tuple)
    throw new ProviderContractError("MangaHere packed reader data is missing")
  const data: MangaHerePackedReaderData = {
    encodedPayload: tuple[1],
    radix: Number(tuple[2]),
    tokenCount: Number(tuple[3]),
    encodedDictionary: tuple[4],
  }
  const { radix, tokenCount: count } = data
  const keys = unpackString(data.encodedDictionary).split("|")
  if (
    radix < 2 ||
    radix > 62 ||
    count > 10_000 ||
    count !== keys.length ||
    data.encodedPayload.length > 2_000_000 ||
    data.encodedDictionary.length > 1_000_000
  ) {
    throw new ProviderContractError(
      "MangaHere packed reader data exceeds its limits"
    )
  }
  const alphabet =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
  const indexFor = (token: string): number => {
    let value = 0
    for (const char of token) {
      const digit = alphabet.indexOf(char)
      if (digit < 0 || digit >= radix) return -1
      value = value * radix + digit
      if (value >= count) return -1
    }
    return value
  }
  const template = unpackString(data.encodedPayload)
  let decodedLength = template.length
  const decoded = template.replace(/\b[0-9a-zA-Z]+\b/g, (token) => {
    const replacement = keys[indexFor(token)] || token
    decodedLength += replacement.length - token.length
    if (decodedLength > 10_000_000) {
      throw new ProviderContractError(
        "MangaHere decoded reader exceeds its size limit"
      )
    }
    return replacement
  })
  const list = decoded.match(
    /\bvar\s+newImgs\s*=\s*\[((?:\s*'[^'<>\\]*'\s*,?\s*)*)\]/
  )?.[1]
  if (list === undefined)
    throw new ProviderContractError(
      "MangaHere image list no longer matches the reader contract"
    )
  const values: string[] = []
  for (const match of list.matchAll(/'([^']+)'/g)) {
    if (values.length === MAX_CHAPTER_IMAGES) {
      throw new ProviderContractError(
        "MangaHere image list exceeds its page limit"
      )
    }
    values.push(mangaHereImage(match[1]))
  }
  const countMatch = html.match(/\bvar\s+imagecount\s*=\s*(\d+)\s*;/)
  if (
    !values.length ||
    values.length > MAX_CHAPTER_IMAGES ||
    !countMatch ||
    Number(countMatch[1]) !== values.length
  ) {
    throw new ProviderContractError("MangaHere reader page count is incomplete")
  }
  return values
}
