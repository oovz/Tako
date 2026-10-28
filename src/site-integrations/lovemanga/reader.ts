import { ReaderParameters } from "./contracts/reader"
import { ProviderContractError } from "../provider-contract-error"
export const AIMANHUA_ORIGIN = "https://www.aimanhua.org"

export function aimanhuaPage(value: string): URL {
  const url = new URL(value)
  if (url.origin !== AIMANHUA_ORIGIN || url.username || url.password)
    throw new ProviderContractError("Aimanhua page origin is not allowed")
  return url
}
export function aimanhuaImage(value: string): string {
  const url = new URL(value, "https://img1.baipiaoguai.org")
  if (
    url.protocol !== "https:" ||
    url.hostname !== "img1.baipiaoguai.org" ||
    url.username ||
    url.password ||
    url.port ||
    !/^\/static\/upload[23]\/book\//.test(url.pathname)
  )
    throw new ProviderContractError(
      "Aimanhua image URL is unavailable or unsupported"
    )
  return url.href
}
export async function decodeAimanhuaImages(
  html: string,
  chapterUrl: string
): Promise<string[]> {
  const chapter = aimanhuaPage(chapterUrl).pathname.match(
    /^\/chapter\/(\d+)\/(\d+)$/
  )
  if (!chapter || html.length > 10_000_000)
    throw new ProviderContractError(
      "Aimanhua chapter URL or reader size is invalid"
    )
  const encoded = html.match(/\bparams\s*=\s*'([A-Za-z0-9+/=]+)'/)?.[1]
  if (!encoded || encoded.length > 1_000_000)
    throw new ProviderContractError(
      "Aimanhua encoded reader data is missing or exceeds its limit"
    )
  try {
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))
    if (bytes.byteLength < 32 || (bytes.byteLength - 16) % 16)
      throw new Error("Invalid envelope length")
    // The site's public viewer uses a 16-byte IV followed by AES-CBC data.
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("9S8$vJnU2ANeSRoF"),
      { name: "AES-CBC" },
      false,
      ["decrypt"]
    )
    const decoded = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: bytes.slice(0, 16) },
      key,
      bytes.slice(16)
    )
    const parameters = ReaderParameters.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded))
    )
    if (
      String(parameters.comic_id) !== chapter[1] ||
      String(parameters.chapter_id) !== chapter[2]
    )
      throw new Error("Reader identity does not match the selected chapter")
    return parameters.images.map((value) => {
      if (!/^https:\/\//.test(value) && String(parameters.source_id) !== "12")
        throw new Error("Unsupported relative image source")
      return aimanhuaImage(value)
    })
  } catch (cause) {
    throw new ProviderContractError(
      "Aimanhua reader data is invalid or the chapter is unavailable",
      cause
    )
  }
}
