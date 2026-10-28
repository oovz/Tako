import { MAX_CHAPTER_IMAGES } from "@/src/constants/timeouts"
import { ProviderContractError } from "../provider-contract-error"
import type { MangagoReaderProtocol } from "./contracts/reader"
import { assertMangagoImageUrl, parseMangagoUrl } from "./shared"

function hex(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value.match(/../g) ?? [], (pair) => parseInt(pair, 16))
}
function undoOrdering(value: string, positions: number[]): string {
  const keys = positions.map((position) => value[position])
  if (!keys.every((key) => key !== undefined && /^\d$/.test(key))) return value
  const chars = [...value].filter((_, index) => !positions.includes(index))
  for (const digit of keys.reverse()) {
    const offset = Number(digit)
    for (let index = chars.length - 1; index >= offset; index--) {
      if (index % 2 === 1)
        [chars[index - offset], chars[index]] = [
          chars[index],
          chars[index - offset],
        ]
    }
  }
  return chars.join("")
}
function parseGrid(value: string, columns: number): number[] {
  const grid = value.split("a").map((part) => (part === "" ? 0 : Number(part)))
  if (
    grid.length !== columns * columns ||
    new Set(grid).size !== grid.length ||
    grid.some(
      (entry) => !Number.isInteger(entry) || entry < 0 || entry >= grid.length
    )
  )
    throw new ProviderContractError("Mangago image tile order is invalid")
  return grid
}
export function parseMangagoProtocol(script: string): MangagoReaderProtocol {
  const encoded = script.match(/null\s*,\s*"([\da-zA-Z]+)"\s*(?:\[|\.)/)?.[1]
  if (!script.includes("sojson.v4") || !encoded || encoded.length > 2_000_000)
    throw new ProviderContractError("Mangago reader script format changed")
  const codes = encoded.split(/[a-zA-Z]+/).filter(Boolean)
  if (codes.some((code) => Number(code) > 65535))
    throw new ProviderContractError("Mangago reader script encoding is invalid")
  const source = codes.map((code) => String.fromCharCode(Number(code))).join("")
  const key = source.match(
    /var\s+key\s*=\s*CryptoJS\.enc\.Hex\.parse\("([a-f\d]{32})"\)/i
  )?.[1]
  const iv = source.match(
    /var\s+iv\s*=\s*CryptoJS\.enc\.Hex\.parse\("([a-f\d]{32})"\)/i
  )?.[1]
  const columns = Number(
    source.match(/widthnum\s*=\s*heightnum\s*=\s*(\d+)/)?.[1]
  )
  const orderPositions = [
    ...new Set(
      [...source.matchAll(/str\.charAt\(\s*(\d+)\s*\)/g)].map((match) =>
        Number(match[1])
      )
    ),
  ]
  const defaultKey = source
    .slice(source.indexOf("var renImg"))
    .match(/var\s+key\s*=\s*"([\da]+)"/)?.[1]
  if (
    !key ||
    !iv ||
    !Number.isInteger(columns) ||
    columns < 1 ||
    columns > 16 ||
    !defaultKey ||
    orderPositions.length !== 4 ||
    orderPositions.some((position) => position > 1024)
  )
    throw new ProviderContractError("Mangago reader protocol changed")
  const grids = new Map<string, number[]>()
  for (const match of source.matchAll(
    /_imgkeys_\["([a-f\d]{32})"\]\s*=\s*"([\da]+)"/g
  ))
    grids.set(match[1], parseGrid(match[2], columns))
  const special = source.match(
    /var\s+_0X2c9a16\s*=\s*img\.src\.indexOf\("([a-f\d]{32})"\)>0\?"([\da]+)":"([\da]+)"/
  )
  if (special) {
    const second = source
      .slice(source.lastIndexOf("if(img.src.indexOf", special.index))
      .match(/\|\|img\.src\.indexOf\("([a-f\d]{32})"\)/)?.[1]
    if (!second)
      throw new ProviderContractError("Mangago special tile mapping changed")
    grids.set(
      special[1],
      parseGrid(undoOrdering(special[2], orderPositions), columns)
    )
    grids.set(
      second,
      parseGrid(undoOrdering(special[3], orderPositions), columns)
    )
  }
  return {
    key: hex(key),
    iv: hex(iv),
    columns,
    orderPositions,
    defaultGrid: parseGrid(defaultKey, columns),
    grids,
  }
}
export async function decodeMangagoImageList(
  encoded: string,
  protocol: MangagoReaderProtocol
): Promise<string[]> {
  if (!/^[a-zA-Z\d+/]+={0,2}$/.test(encoded) || encoded.length > 2_000_000)
    throw new ProviderContractError("Mangago encrypted page list is invalid")
  const bytes = Uint8Array.from(atob(encoded), (character) =>
    character.charCodeAt(0)
  )
  if (bytes.length === 0 || bytes.length % 16 !== 0)
    throw new ProviderContractError(
      "Mangago encrypted page list length is invalid"
    )
  const key = await crypto.subtle.importKey(
    "raw",
    protocol.key,
    "AES-CBC",
    false,
    ["decrypt", "encrypt"]
  )
  // Web Crypto removes PKCS#7 padding. Append one encrypted padding block so the site's zero-padded plaintext remains intact.
  const padding = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-CBC", iv: bytes.slice(-16) },
      key,
      new Uint8Array()
    )
  )
  const padded = new Uint8Array(bytes.length + padding.length)
  padded.set(bytes)
  padded.set(padding, bytes.length)
  const plaintext = new TextDecoder("utf-8", { fatal: true })
    .decode(
      await crypto.subtle.decrypt(
        { name: "AES-CBC", iv: protocol.iv },
        key,
        padded
      )
    )
    .replace(/\0+$/, "")
  const entries = undoOrdering(plaintext, protocol.orderPositions).split(",")
  if (!entries.length || entries.length > MAX_CHAPTER_IMAGES + 2)
    throw new ProviderContractError("Mangago page list exceeds its limit")
  return entries
}
export function parseMangagoReader(
  document: Document,
  readerUrl: string
): {
  encryptedImages: string
  scriptUrl: string
  totalPages: number
  currentPage: number
  pageUrl: (page: number) => string
} {
  const parsed = parseMangagoUrl(readerUrl)
  if (!parsed.chapterId)
    throw new ProviderContractError(
      "Mangago reader URL has no chapter identity"
    )
  const scripts = [...document.scripts]
    .map((script) => script.textContent ?? "")
    .join("\n")
  const totalPages = Number(scripts.match(/\btotal_pages\s*=\s*(\d+)/)?.[1])
  const currentPage = Number(scripts.match(/\bcurrent_page\s*=\s*(\d+)/)?.[1])
  const encryptedImages = scripts.match(
    /\bvar\s+imgsrcs\s*=\s*['"]([a-zA-Z\d+/=]+)['"]/
  )?.[1]
  const template = document.querySelector("input#curl")?.getAttribute("value")
  const source = document
    .querySelector('script[src*="/js/chapter.js"]')
    ?.getAttribute("src")
  const scriptUrl = source ? new URL(source, readerUrl) : undefined
  if (
    !Number.isInteger(totalPages) ||
    totalPages < 1 ||
    totalPages > MAX_CHAPTER_IMAGES ||
    !Number.isInteger(currentPage) ||
    currentPage < 1 ||
    currentPage > totalPages ||
    !encryptedImages ||
    !template?.includes("{page}") ||
    scriptUrl?.origin !== "https://pic1.mangapicgallery.com" ||
    scriptUrl.pathname !== "/js/chapter.js"
  )
    throw new ProviderContractError(
      "Mangago reader content is unavailable or incomplete"
    )
  const pageUrl = (page: number) => {
    const url = `${parsed.readerPrefix}${template.replace("{page}", String(page))}`
    if (parseMangagoUrl(url).chapterId !== parsed.chapterId)
      throw new ProviderContractError(
        "Mangago reader navigation changed chapter"
      )
    return url
  }
  pageUrl(1)
  return {
    encryptedImages,
    scriptUrl: scriptUrl.href,
    totalPages,
    currentPage,
    pageUrl,
  }
}
export function withMangagoGrid(
  imageUrl: string,
  protocol: MangagoReaderProtocol
): string {
  assertMangagoImageUrl(imageUrl)
  if (!new URL(imageUrl).pathname.startsWith("/r/cspiclink/")) return imageUrl
  let grid = protocol.defaultGrid
  for (const [signature, order] of protocol.grids)
    if (imageUrl.includes(signature)) grid = order
  const url = new URL(imageUrl)
  url.hash = `mg-grid=${protocol.columns}:${grid.join(",")}`
  return url.href
}
