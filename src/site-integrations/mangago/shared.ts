import { ProviderContractError } from "../provider-contract-error"

export const MANGAGO_ORIGIN = "https://www.mangago.me"
export function parseMangagoUrl(value: string): {
  url: URL
  seriesId: string
  chapterId?: string
  readerPrefix?: string
} {
  const url = new URL(value)
  const match = url.pathname.match(
    /^\/read-manga\/([a-z0-9_]+)\/(?:([a-z0-9_-]+)\/([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+){0,3})\/?)?$/
  )
  if (
    (url.origin !== MANGAGO_ORIGIN && url.origin !== "https://mangago.me") ||
    url.username ||
    url.password ||
    !match
  )
    throw new ProviderContractError("Invalid Mangago series or reader URL")
  let chapterPath: string | undefined
  if (match[3]) {
    const parts = match[3].split("/")
    if (/^pg-[1-9]\d*$/.test(parts.at(-1) ?? "")) {
      parts.pop()
      chapterPath = parts.join("/")
    } else {
      // Older single-key chapters can end in .html or carry a display alias.
      if (
        parts.length > 2 ||
        (parts.length === 1 &&
          !url.pathname.endsWith("/") &&
          !parts[0].endsWith(".html"))
      )
        throw new ProviderContractError("Invalid Mangago chapter route")
      chapterPath = parts[0]
    }
    if (!chapterPath)
      throw new ProviderContractError(
        "Mangago reader URL has no chapter identity"
      )
  }
  return {
    url,
    seriesId: match[1],
    chapterId: chapterPath ? `${match[2]}:${chapterPath}` : undefined,
    readerPrefix: `${url.origin}/read-manga/${match[1]}`,
  }
}
export function assertMangagoImageUrl(value: string): void {
  const url = new URL(value)
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !/^[a-z0-9_-]+\.mangapicgallery\.com$/i.test(url.hostname) ||
    !/^\/r\/(?:newpiclink|cspiclink|coverlink)\//.test(url.pathname)
  )
    throw new ProviderContractError(
      "Mangago returned an unsupported content image URL"
    )
}
