import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
} from "@/src/types/site-integrations"
import { integrationHttpClient } from "../http-client"
import { cancelResponseBody } from "@/src/shared/response-body"
import {
  decodeHtmlResponse,
  readResponseText,
} from "@/src/shared/html-response-decoder"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"
import { ChapterImagePlanSchema } from "../chapter-plan"
import { ProviderContractError } from "../provider-contract-error"
import { parseMangagoSeries } from "./series-dom"
import { assertMangagoImageUrl, parseMangagoUrl } from "./shared"
import {
  decodeMangagoImageList,
  parseMangagoProtocol,
  parseMangagoReader,
  withMangagoGrid,
} from "./reader"
import {
  parseMangagoImageTransport,
  reconstructMangagoImage,
} from "./grid-image"

const downloadImage: OffscreenIntegration["chapter"]["downloadImage"] = async (
  imageUrl,
  opts
) => {
  const { sourceUrl, columns, grid } = parseMangagoImageTransport(imageUrl)
  assertMangagoImageUrl(sourceUrl)
  const result = await fetchImageWithStallDetection(sourceUrl, {
    integrationId: "mangago",
    endpointId: "mangago-image",
    signal: opts.signal,
    rateLimitService: opts.runtime.rateLimitService,
    rateLimitPolicy: opts.runtime.rateLimitSettings.image,
    skipRateLimit: true,
    onBytesReceived: opts.onBytesReceived,
    assertUrlAllowed: assertMangagoImageUrl,
    init: { credentials: "omit" },
    liveResourceLedger: opts.liveResourceLedger,
  })
  const filename = new URL(sourceUrl).pathname.split("/").pop()!
  if (!grid || !columns) return { ...result, filename }
  const reconstructed = await reconstructMangagoImage(
    result.data,
    result.mimeType,
    columns,
    grid,
    opts.signal,
    opts.liveResourceLedger,
    result.liveResourceLease
  )
  return { ...reconstructed, filename: filename.replace(/\.[^.]+$/, ".png") }
}
type ChapterPlanInput = Parameters<
  OffscreenIntegration["chapter"]["resolveChapterPlan"]
>[1]
type MangagoReader = ReturnType<typeof parseMangagoReader>
type MangagoProtocol = ReturnType<typeof parseMangagoProtocol>

async function requestReaderResource(
  url: string,
  input: ChapterPlanInput,
  script = false
): Promise<string> {
  input.signal?.throwIfAborted()
  const response = await integrationHttpClient.request({
    integrationId: "mangago",
    endpointId: script ? "mangago-script" : "mangago-page",
    url,
    scope: "chapter",
    rateLimitService: input.runtime.rateLimitService,
    policyOverride: input.runtime.rateLimitSettings.chapter,
    init: { credentials: script ? "omit" : "include", signal: input.signal },
  })
  if (!response.ok) {
    cancelResponseBody(response)
    throw Object.assign(
      new Error(`Mangago reader request failed (HTTP ${response.status})`),
      { status: response.status }
    )
  }
  return script
    ? readResponseText(response, 2_000_000)
    : (
        await decodeHtmlResponse(response, {
          // Viewer scripts precede its explicit charset declaration.
          scanByteLimit: 64 * 1024,
        })
      ).html
}

async function readReaderPage(
  url: string,
  input: ChapterPlanInput
): Promise<MangagoReader> {
  const html = await requestReaderResource(url, input)
  return parseMangagoReader(
    new DOMParser().parseFromString(html, "text/html"),
    url
  )
}

async function recoverReaderEntries(
  first: MangagoReader,
  protocol: MangagoProtocol,
  entries: string[],
  index: number,
  input: ChapterPlanInput
): Promise<void> {
  const url = first.pageUrl(index + 1)
  const reader = await readReaderPage(url, input)
  if (
    reader.totalPages !== first.totalPages ||
    reader.currentPage !== index + 1 ||
    reader.scriptUrl !== first.scriptUrl
  )
    throw new ProviderContractError("Mangago reader page sequence changed")
  const batch = await decodeMangagoImageList(reader.encryptedImages, protocol)
  for (let position = index; position < first.totalPages; position++)
    if (batch[position]?.trim()) entries[position] = batch[position]!
}

async function collectChapterImages(
  first: MangagoReader,
  protocol: MangagoProtocol,
  input: ChapterPlanInput
): Promise<string[]> {
  const entries = await decodeMangagoImageList(first.encryptedImages, protocol)
  const imageUrls: string[] = []
  for (let index = 0; index < first.totalPages; index++) {
    let source = entries[index]?.trim()
    if (!source) {
      await recoverReaderEntries(first, protocol, entries, index, input)
      source = entries[index]?.trim()
    }
    if (!source)
      throw new ProviderContractError(
        `Mangago required page ${index + 1} is unavailable`
      )
    imageUrls.push(withMangagoGrid(source, protocol))
  }
  return imageUrls
}

async function resolveChapterPlan(
  chapter: Parameters<OffscreenIntegration["chapter"]["resolveChapterPlan"]>[0],
  input: ChapterPlanInput
): ReturnType<OffscreenIntegration["chapter"]["resolveChapterPlan"]> {
  if (parseMangagoUrl(chapter.url).chapterId !== chapter.id)
    throw new ProviderContractError(
      "Mangago selected chapter does not match its URL"
    )
  const first = await readReaderPage(chapter.url, input)
  const protocol = parseMangagoProtocol(
    await requestReaderResource(first.scriptUrl, input, true)
  )
  const imageUrls = await collectChapterImages(first, protocol, input)
  return ChapterImagePlanSchema.parse({ imageUrls })
}

const offscreen: OffscreenIntegration = {
  name: "Mangago Offscreen",
  series: {
    resolveSeriesData({ document, seriesUrl }) {
      return Promise.resolve(parseMangagoSeries(document, seriesUrl))
    },
  },
  cover: { downloadImage },
  chapter: { resolveChapterPlan, downloadImage },
}
export const offscreenSiteAdapter: OffscreenSiteAdapter = { offscreen }
