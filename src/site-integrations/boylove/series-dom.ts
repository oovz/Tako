import { BoyloveCatalogSchema } from "./contracts/reader"
import { ProviderContractError } from "../provider-contract-error"
import {
  parseChapterNumber,
  sanitizeLabel,
} from "@/src/shared/site-integration-utils"
import type { Chapter } from "@/src/types/chapter"
import type { SeriesMetadata } from "@/src/types/series-metadata"

export const BOYLOVE_ORIGIN = "https://boylove.cc"

export function assertBoylovePageUrl(
  value: string,
  kind: "index" | "capter"
): URL {
  const url = new URL(value)
  if (
    url.origin !== BOYLOVE_ORIGIN ||
    url.username ||
    url.password ||
    !new RegExp(`^/home/book/${kind}/id/[1-9]\\d*/?$`).test(url.pathname)
  ) {
    throw new ProviderContractError(
      "BoyLove page URL is not a supported trusted route."
    )
  }
  return url
}

export function assertBoyloveImageUrl(value: string): URL {
  const url = new URL(value)
  if (
    url.origin !== "https://img.boylove.cc" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith("/bookimages/")
  ) {
    throw new ProviderContractError(
      "BoyLove chapter image is unavailable or its URL is not allowed."
    )
  }
  return url
}

export function resolveBoyloveSeries(document: Document) {
  const title = sanitizeLabel(
    document.querySelector(".stui-content__detail h1")?.textContent ?? ""
  )
  if (!title)
    throw new ProviderContractError("BoyLove series title is missing.")
  const cover = document
    .querySelector(".stui-content__thumb .play")
    ?.getAttribute("data-original")
  const seriesMetadata: SeriesMetadata = {
    title,
    author:
      sanitizeLabel(
        document.querySelector(".stui-content__detail .data i + a")
          ?.textContent ?? ""
      ) || undefined,
    description:
      document
        .querySelector('meta[property="og:description"]')
        ?.getAttribute("content")
        ?.trim() || undefined,
    coverUrl: cover ? assertBoyloveImageUrl(cover).href : undefined,
    language: "zh",
  }
  const catalogScript = Array.from(document.scripts)
    .map((script) => script.textContent ?? "")
    .find((script) => /function\s+getChapterList\s*\(/.test(script))
  const encoded = catalogScript?.match(
    /function\s+getChapterList\s*\([^)]*\)\s*\{\s*(?:let|var|const)\s+data\s*=\s*JSON\.parse\(\s*("(?:\\.|[^"\\])*")\s*\)/
  )?.[1]
  if (!encoded)
    throw new ProviderContractError(
      "BoyLove chapter catalog is missing or unavailable."
    )
  let payload: unknown
  try {
    const serialized: unknown = JSON.parse(encoded)
    if (typeof serialized !== "string")
      throw new Error("Expected serialized catalog")
    payload = JSON.parse(serialized)
  } catch (error) {
    throw new ProviderContractError(
      "BoyLove chapter catalog is malformed.",
      error
    )
  }
  const catalog = BoyloveCatalogSchema.parse(payload)
  const seen = new Set<number>()
  const chapters: Chapter[] = catalog.list.map((item) => {
    if (seen.has(item.id))
      throw new ProviderContractError(
        "BoyLove chapter catalog contains duplicate chapters."
      )
    seen.add(item.id)
    return {
      id: String(item.id),
      title: sanitizeLabel(item.title),
      chapterLabel: sanitizeLabel(item.title),
      chapterNumber: parseChapterNumber(item.title),
      url: `${BOYLOVE_ORIGIN}/home/book/capter/id/${item.id}`,
      locked: item.isvip === "1",
      comicInfo: { Title: sanitizeLabel(item.title), LanguageISO: "zh" },
    }
  })
  return { seriesMetadata, chapterList: { chapters } }
}
