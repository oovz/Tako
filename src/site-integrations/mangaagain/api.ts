import {
  ZaimanhuaEnvelopeSchema,
  ZaimanhuaSeriesDataSchema,
  ZaimanhuaChapterDataSchema,
} from "./contracts/api"
import { readResponseJson } from "@/src/shared/html-response-decoder"
import { cancelResponseBody } from "@/src/shared/response-body"
import { parseChapterNumber } from "@/src/shared/site-integration-utils"
import { integrationHttpClient } from "../http-client"
import { ProviderContractError } from "../provider-contract-error"
import type { Chapter } from "@/src/types/chapter"
import type { RateLimitService } from "@/src/runtime/rate-limit"

function assertZaimanhuaOrigin(url: URL): void {
  if (
    url.protocol !== "https:" ||
    !["www.zaimanhua.com", "manhua.zaimanhua.com"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new ProviderContractError("Zaimanhua origin is unavailable")
  }
}

export function parseZaimanhuaUrl(value: string): {
  url: URL
  slug: string
  variant: "comic1" | "comic2"
  seriesId?: string
  chapterId?: string
} {
  const url = new URL(value)
  assertZaimanhuaOrigin(url)
  const series = url.pathname.match(/^\/info\/([a-z0-9_-]+)\.html\/?$/)
  const reader = url.pathname.match(/^\/view\/([a-z0-9_-]+)\/(\d+)\/(\d+)\/?$/)
  const slug = series?.[1] ?? reader?.[1]
  if (!slug)
    throw new ProviderContractError("Zaimanhua series route is unavailable")
  return {
    url,
    slug,
    variant: url.hostname === "www.zaimanhua.com" ? "comic1" : "comic2",
    seriesId: reader?.[2],
    chapterId: reader?.[3],
  }
}

function envelope(value: unknown): unknown {
  const result = ZaimanhuaEnvelopeSchema.parse(value)
  if (result.errno !== 0)
    throw new ProviderContractError("Zaimanhua content is unavailable")
  return result.data
}

type SeriesInfo = ReturnType<
  typeof ZaimanhuaSeriesDataSchema.parse
>["comicInfo"]

function readChapters(info: SeriesInfo, source: URL): Chapter[] {
  if (
    info.chapterList.reduce((total, group) => total + group.data.length, 0) >
    20_000
  ) {
    throw new ProviderContractError(
      "Zaimanhua chapter catalog exceeds the supported size"
    )
  }
  const seen = new Set<number>()
  const chapters: Chapter[] = []
  for (const group of info.chapterList) {
    for (const chapter of [...group.data].sort(
      (a, b) => a.chapter_order - b.chapter_order
    )) {
      if (seen.has(chapter.chapter_id))
        throw new ProviderContractError(
          "Zaimanhua returned duplicate chapter identities"
        )
      seen.add(chapter.chapter_id)
      const chapterNumber = parseChapterNumber(chapter.chapter_title)
      chapters.push({
        id: String(chapter.chapter_id),
        url: new URL(
          `/view/${info.comicPy}/${info.id}/${chapter.chapter_id}`,
          source.origin
        ).href,
        title: chapter.chapter_title,
        locked: !info.canRead || chapter.is_fee,
        chapterNumber,
        language: "zh",
        comicInfo: { Series: info.title, Title: chapter.chapter_title },
      })
    }
  }
  if (!chapters.length || chapters.length > 20_000)
    throw new ProviderContractError("Zaimanhua chapter catalog is unavailable")
  return chapters
}

function readMetadata(info: SeriesInfo) {
  return {
    title: info.title,
    author:
      info.authorInfo?.authorName ||
      info.authorsTagList?.map((author) => author.tagName).join(", "),
    description: info.description,
    coverUrl: info.cover,
    genres:
      info.themeTagList?.map((theme) => theme.tagName) ??
      info.types?.split(","),
    language: "zh",
  }
}

export function parseZaimanhuaSeries(value: unknown, source: URL) {
  const route = parseZaimanhuaUrl(source.href)
  const info = ZaimanhuaSeriesDataSchema.parse(envelope(value)).comicInfo
  if (
    info.comicPy !== route.slug ||
    (route.seriesId && String(info.id) !== route.seriesId)
  ) {
    throw new ProviderContractError(
      "Zaimanhua series identity does not match the requested work"
    )
  }
  const chapters = readChapters(info, source)
  return {
    seriesId: String(info.id),
    seriesMetadata: readMetadata(info),
    chapterList: chapters,
  }
}

export function parseZaimanhuaChapter(
  value: unknown,
  seriesId: string,
  chapterId: string
): string[] {
  const info = ZaimanhuaChapterDataSchema.parse(envelope(value)).chapterInfo
  if (
    String(info.comic_id) !== seriesId ||
    String(info.chapter_id) !== chapterId
  )
    throw new ProviderContractError(
      "Zaimanhua chapter identity does not match the requested chapter"
    )
  return info.page_url
}

export async function requestZaimanhuaJson(
  url: URL,
  rateLimitService: RateLimitService,
  signal?: AbortSignal
): Promise<unknown> {
  const response = await integrationHttpClient.request({
    integrationId: "mangaagain",
    endpointId: "mangaagain-api",
    url: url.href,
    scope: "chapter",
    rateLimitService,
    init: { credentials: "include", headers: { Platform: "pc" }, signal },
  })
  if (!response.ok) {
    cancelResponseBody(response)
    throw Object.assign(
      new Error(`Zaimanhua request failed (HTTP ${response.status})`),
      { status: response.status }
    )
  }
  return readResponseJson(response)
}

export function zaimanhuaApiUrl(
  route: ReturnType<typeof parseZaimanhuaUrl>,
  kind: "comic" | "chapter"
): URL {
  const url = new URL(
    `/api/v1/${route.variant}/${kind}/detail`,
    route.url.origin
  )
  url.search = new URLSearchParams({
    channel: "pc",
    app_name: "zmh",
    version: "1.0.0",
    timestamp: String(Date.now()),
    uid: "0",
    ...(kind === "comic"
      ? { comic_py: route.slug }
      : { comic_id: route.seriesId!, chapter_id: route.chapterId! }),
  }).toString()
  return url
}
