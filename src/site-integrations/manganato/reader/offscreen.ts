import type { Chapter } from "@/src/types/chapter"
import type {
  OffscreenSiteAdapter,
  SeriesDataResolutionResult,
} from "@/src/types/site-integrations"
import type { SeriesMetadata } from "@/src/types/series-metadata"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"
import {
  getRateLimitPolicyFromSnapshot,
  type RateLimitService,
} from "@/src/runtime/rate-limit"
import { decodeHtmlResponse } from "@/src/shared/html-response-decoder"
import { cancelResponseBody } from "@/src/shared/response-body"
import { sanitizeLabel } from "@/src/shared/site-integration-utils"
import { integrationHttpClient } from "../../http-client"
import { ProviderContractError } from "../../provider-contract-error"
import {
  assertManganatoImageUrl,
  canonicalManganatoUrl,
  parseManganatoChapterImages,
  parseManganatoChapterPage,
  type ManganatoSite,
} from "./protocol"

function readMetadata(document: Document): SeriesMetadata {
  const title = sanitizeLabel(
    document.querySelector(".manga-info-text h1")?.textContent ?? ""
  )
  if (!title) throw new ProviderContractError("Series title is unavailable")
  const details = Array.from(
    document.querySelectorAll(".manga-info-text > li")
  ).map((item) => sanitizeLabel(item.textContent ?? ""))
  const coverUrl = document
    .querySelector('meta[property="og:image"]')
    ?.getAttribute("content")
  const alternative = sanitizeLabel(
    document.querySelector(".story-alternative")?.textContent ?? ""
  ).replace(/^Alternative\s*:\s*/, "")
  return {
    title,
    author: details
      .find((value) => /^Author\(s\)\s*:/.test(value))
      ?.replace(/^Author\(s\)\s*:\s*/, ""),
    status: details
      .find((value) => /^Status\s*:/.test(value))
      ?.replace(/^Status\s*:\s*/, ""),
    coverUrl: coverUrl ? assertManganatoImageUrl(coverUrl).href : undefined,
    description:
      sanitizeLabel(document.querySelector("#contentBox")?.textContent ?? "") ||
      undefined,
    genres: Array.from(document.querySelectorAll(".manga-info-text .genres a"))
      .map((item) => sanitizeLabel(item.textContent ?? ""))
      .filter(Boolean),
    alternativeTitles: alternative ? [alternative] : undefined,
    language: "en",
  }
}

async function readChapters(
  site: ManganatoSite,
  document: Document,
  seriesUrl: string,
  rateLimitService: RateLimitService,
  signal?: AbortSignal
): Promise<Chapter[]> {
  const url = canonicalManganatoUrl(seriesUrl, site)
  const slug = url.pathname.split("/")[2]
  if (
    document
      .querySelector("#chapter-list-container")
      ?.getAttribute("data-comic-slug") !== slug
  ) {
    throw new ProviderContractError("Series chapter catalog is unavailable")
  }
  const chapters: Chapter[] = []
  const ids = new Set<string>()
  let offset = 0
  let total: number | undefined
  for (;;) {
    signal?.throwIfAborted()
    const apiUrl = new URL(`/api/manga/${slug}/chapters`, url)
    apiUrl.searchParams.set("offset", String(offset))
    apiUrl.searchParams.set("limit", "50")
    const response = await integrationHttpClient.request({
      integrationId: site.id,
      endpointId: `${site.id}-chapters`,
      url: apiUrl.href,
      scope: "chapter",
      rateLimitService,
      init: { signal },
    })
    if (!response.ok) {
      cancelResponseBody(response)
      throw Object.assign(
        new Error(`Chapter catalog request failed (HTTP ${response.status})`),
        { status: response.status }
      )
    }
    const { data } = parseManganatoChapterPage(await response.json())
    const page = data.pagination
    total ??= page.total
    if (
      page.total !== total ||
      page.offset !== offset ||
      data.chapters.length > page.limit ||
      (page.has_more && data.chapters.length === 0)
    ) {
      throw new ProviderContractError(
        "Chapter catalog pagination is inconsistent"
      )
    }
    for (const chapter of data.chapters) {
      if (ids.has(chapter.chapter_slug))
        throw new ProviderContractError(
          "Chapter catalog contains duplicate identities"
        )
      ids.add(chapter.chapter_slug)
      chapters.push({
        id: chapter.chapter_slug,
        url: new URL(`/manga/${slug}/${chapter.chapter_slug}`, url).href,
        title: chapter.chapter_name,
        chapterLabel: String(chapter.chapter_num),
        chapterNumber: chapter.chapter_num,
        language: "en",
        comicInfo: {
          Title: chapter.chapter_name,
          Number: String(chapter.chapter_num),
          LanguageISO: "en",
        },
      })
    }
    offset += data.chapters.length
    if (offset > total || page.has_more !== offset < total)
      throw new ProviderContractError("Chapter catalog is incomplete")
    if (!page.has_more) break
  }
  return chapters.reverse()
}

export function createManganatoOffscreenAdapter(
  site: ManganatoSite
): OffscreenSiteAdapter {
  const downloadImage: OffscreenSiteAdapter["offscreen"]["chapter"]["downloadImage"] =
    async (imageUrl, opts) => {
      const url = assertManganatoImageUrl(imageUrl)
      const result = await fetchImageWithStallDetection(url.href, {
        integrationId: site.id,
        endpointId: `${site.id}-image`,
        signal: opts.signal,
        rateLimitService: opts.runtime.rateLimitService,
        rateLimitPolicy: opts.runtime.rateLimitSettings.image,
        // Chapter and cover pipelines own image scheduling.
        skipRateLimit: true,
        liveResourceLedger: opts.liveResourceLedger,
        onBytesReceived: opts.onBytesReceived,
        assertUrlAllowed: assertManganatoImageUrl,
      })
      return {
        ...result,
        filename: url.pathname.split("/").pop() || "image.webp",
      }
    }
  return {
    offscreen: {
      name: `${site.name} Offscreen`,
      series: {
        async resolveSeriesData(input) {
          const result: SeriesDataResolutionResult = {}
          try {
            result.seriesMetadata = readMetadata(input.document)
          } catch (error) {
            result.metadataError =
              error instanceof Error ? error.message : String(error)
          }
          try {
            result.chapterList = await readChapters(
              site,
              input.document,
              input.seriesUrl,
              input.rateLimitService,
              input.signal
            )
          } catch (error) {
            result.chapterListError =
              error instanceof Error ? error.message : String(error)
          }
          return result
        },
      },
      cover: { downloadImage },
      chapter: {
        async resolveChapterPlan(chapter, input) {
          const url = canonicalManganatoUrl(chapter.url, site, true)
          if (url.pathname.split("/")[3] !== chapter.id)
            throw new ProviderContractError(
              `${site.name} selected chapter identity does not match its URL`
            )
          const response = await integrationHttpClient.request({
            integrationId: site.id,
            endpointId: `${site.id}-page`,
            url: url.href,
            scope: "chapter",
            rateLimitService: input.runtime.rateLimitService,
            policyOverride: getRateLimitPolicyFromSnapshot(
              input.settings,
              "chapter"
            ),
            init: { signal: input.signal },
          })
          if (!response.ok) {
            cancelResponseBody(response)
            throw Object.assign(
              new Error(`Reader request failed (HTTP ${response.status})`),
              { status: response.status }
            )
          }
          const { html } = await decodeHtmlResponse(response)
          return { imageUrls: parseManganatoChapterImages(html) }
        },
        downloadImage,
      },
    },
  }
}
