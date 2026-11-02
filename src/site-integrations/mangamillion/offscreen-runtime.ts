import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
} from "@/src/types/site-integrations"
import { ChapterImagePlanSchema } from "@/src/site-integrations/chapter-plan"
import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"
import { createIntegrationEndpointUrlAssertion } from "@/src/site-integrations/request-policy"
import type {
  OffscreenLiveResourceLedger,
  OffscreenLiveResourceLease,
} from "@/src/runtime/offscreen-live-resource-ledger"
import { fetchViewer } from "./api"
import type {
  MangaMillionViewer,
  MangaMillionViewerPage,
} from "./contracts/api"
import { convertMangaMillionAvifToJpeg } from "./avif"
import { decryptPageImage, detectImageMimeTypeAndExt } from "./crypto"
import {
  isTrustedMangaMillionAssetUrl,
  parseMangaMillionChapterId,
  parseMangaMillionSeriesUrl,
} from "./urls"

const assertMangaMillionImageUrl = createIntegrationEndpointUrlAssertion(
  "mangamillion",
  "mangamillion-image"
)

type OwnedImage = {
  data: ArrayBuffer
  filename: string
  mimeType: string
  liveResourceLease: OffscreenLiveResourceLease
}

async function normalizeMangaMillionImage(
  image: {
    data: ArrayBuffer
    mimeType: string
    extension: string
    liveResourceLease: OffscreenLiveResourceLease
  },
  signal: AbortSignal | undefined,
  liveResourceLedger: OffscreenLiveResourceLedger
): Promise<{
  data: ArrayBuffer
  mimeType: string
  extension: string
  liveResourceLease: OffscreenLiveResourceLease
}> {
  let sourceLease: OffscreenLiveResourceLease | undefined =
    image.liveResourceLease
  try {
    if (image.mimeType !== "image/avif") {
      sourceLease = undefined
      return image
    }

    const converted = await convertMangaMillionAvifToJpeg(
      image.data,
      signal,
      liveResourceLedger,
      image.liveResourceLease
    )
    sourceLease = undefined
    return {
      ...converted,
      extension: ".jpg",
    }
  } finally {
    sourceLease?.release()
  }
}

function buildMangaMillionImageFilename(
  rawUrl: string,
  extension: string
): string {
  const rawFilename =
    new URL(rawUrl).pathname.split("/").filter(Boolean).pop() || "page"
  const cleanFilename = rawFilename.replace(/\.enc$/i, "")
  return cleanFilename.endsWith(extension)
    ? cleanFilename
    : cleanFilename.replace(/\.[a-zA-Z0-9]+$/, "") + extension
}

type ImageDownloadOptions = Parameters<
  OffscreenIntegration["chapter"]["downloadImage"]
>[1]
type ReconstructedImage = {
  data: ArrayBuffer
  mimeType: string
  extension: string
  liveResourceLease: OffscreenLiveResourceLease
}

async function downloadMangaMillionCover(
  imageUrl: string,
  opts: ImageDownloadOptions
): Promise<OwnedImage> {
  if (!isTrustedMangaMillionAssetUrl(imageUrl)) {
    throw new ProviderContractError(
      "Invalid or untrusted MangaMillion cover asset URL."
    )
  }
  if (opts.signal?.aborted) {
    throw new Error("aborted")
  }

  const fetched = await fetchImageWithStallDetection(imageUrl, {
    integrationId: "mangamillion",
    endpointId: "mangamillion-image",
    signal: opts.signal,
    rateLimitPolicy: opts.runtime.rateLimitSettings.image,
    rateLimitService: opts.runtime.rateLimitService,
    skipRateLimit: true,
    onBytesReceived: opts.onBytesReceived,
    assertUrlAllowed: assertMangaMillionImageUrl,
    liveResourceLedger: opts.liveResourceLedger,
    allowEncodedImageMimeType: true,
    init: { credentials: "omit" },
  })
  let fetchedLease: OffscreenLiveResourceLease | undefined =
    fetched.liveResourceLease
  try {
    const detected = detectImageMimeTypeAndExt(new Uint8Array(fetched.data))
    const image = await normalizeMangaMillionImage(
      {
        data: fetched.data,
        mimeType: detected.mimeType,
        extension: detected.extension,
        liveResourceLease: fetchedLease,
      },
      opts.signal,
      opts.liveResourceLedger
    )
    fetchedLease = undefined

    const filename =
      image.mimeType === "image/jpeg"
        ? "cover.jpg"
        : new URL(imageUrl).pathname.split("/").filter(Boolean).pop() ||
          `cover${image.extension}`

    return { ...image, filename }
  } finally {
    fetchedLease?.release()
  }
}

function buildViewerImageUrls(
  pages: MangaMillionViewerPage[],
  aesKey?: string,
  aesIv?: string
): string[] {
  const fragment =
    aesKey && aesIv
      ? `#k=${encodeURIComponent(aesKey)}&iv=${encodeURIComponent(aesIv)}`
      : ""
  const imageUrls: string[] = []
  for (const page of pages) {
    if (page.imageUrl) imageUrls.push(`${page.imageUrl}${fragment}`)
  }
  return imageUrls
}

function createChapterImagePlan(viewer: MangaMillionViewer, chapterId: number) {
  const pages = viewer.pages ?? []
  if (pages.length === 0) {
    throw new ProviderContractError(
      `No pages found in MangaMillion viewer for chapter ${chapterId}.`
    )
  }
  const imageUrls = buildViewerImageUrls(pages, viewer.aesKey, viewer.aesIv)
  if (imageUrls.length === 0) {
    throw new ProviderContractError(
      `No valid image URLs found for MangaMillion chapter ${chapterId}.`
    )
  }
  return ChapterImagePlanSchema.parse({ imageUrls })
}

async function resolveMangaMillionChapterPlan(
  chapter: Parameters<OffscreenIntegration["chapter"]["resolveChapterPlan"]>[0],
  input: Parameters<OffscreenIntegration["chapter"]["resolveChapterPlan"]>[1]
) {
  const chapterId =
    parseMangaMillionChapterId(chapter.id) ??
    parseMangaMillionChapterId(chapter.url)

  if (!chapterId) {
    throw new ProviderContractError(
      `Invalid MangaMillion chapter identifier: ${chapter.id}`
    )
  }

  const parsedUrl = parseMangaMillionSeriesUrl(chapter.url)
  const language = parsedUrl?.language || "en"

  const viewer = await fetchViewer(
    chapterId,
    language,
    "middle",
    input.runtime.rateLimitService,
    input.signal
  )

  return createChapterImagePlan(viewer, chapterId)
}

async function reconstructChapterImage(
  data: ArrayBuffer,
  fragment: string | undefined,
  opts: ImageDownloadOptions,
  sourceLease: OffscreenLiveResourceLease
): Promise<ReconstructedImage> {
  const params = fragment ? new URLSearchParams(fragment) : null
  const aesKey = params?.get("k")
  const aesIv = params?.get("iv")
  if (aesKey && aesIv) {
    return decryptPageImage(
      data,
      aesKey,
      aesIv,
      opts.liveResourceLedger,
      sourceLease
    )
  }
  const detected = detectImageMimeTypeAndExt(new Uint8Array(data))
  return { data, ...detected, liveResourceLease: sourceLease }
}

async function downloadMangaMillionChapterImage(
  imageUrl: string,
  opts: ImageDownloadOptions
): Promise<OwnedImage> {
  if (opts.signal?.aborted) {
    throw new Error("aborted")
  }

  const [rawUrl, fragment] = imageUrl.split("#")
  if (!isTrustedMangaMillionAssetUrl(rawUrl)) {
    throw new ProviderContractError(
      "Invalid or untrusted MangaMillion chapter asset URL."
    )
  }

  const fetched = await fetchImageWithStallDetection(rawUrl, {
    integrationId: "mangamillion",
    endpointId: "mangamillion-image",
    signal: opts.signal,
    rateLimitPolicy: opts.runtime.rateLimitSettings.image,
    rateLimitService: opts.runtime.rateLimitService,
    // Image batches are already scheduled by chapter-image-downloads;
    // re-scheduling here deadlocks the shared rate limiter.
    skipRateLimit: true,
    onBytesReceived: opts.onBytesReceived,
    assertUrlAllowed: assertMangaMillionImageUrl,
    liveResourceLedger: opts.liveResourceLedger,
    allowEncodedImageMimeType: true,
    init: { credentials: "omit" },
  })

  let fetchedLease: OffscreenLiveResourceLease | undefined =
    fetched.liveResourceLease
  try {
    const reconstructed = await reconstructChapterImage(
      fetched.data,
      fragment,
      opts,
      fetchedLease
    )
    const finalImage = await normalizeMangaMillionImage(
      reconstructed,
      opts.signal,
      opts.liveResourceLedger
    )
    fetchedLease = undefined

    return {
      data: finalImage.data,
      filename: buildMangaMillionImageFilename(rawUrl, finalImage.extension),
      mimeType: finalImage.mimeType,
      liveResourceLease: finalImage.liveResourceLease,
    }
  } finally {
    fetchedLease?.release()
  }
}

export const offscreen: OffscreenIntegration = {
  name: "MangaMillion Offscreen",
  cover: { downloadImage: downloadMangaMillionCover },
  chapter: {
    resolveChapterPlan: resolveMangaMillionChapterPlan,
    downloadImage: downloadMangaMillionChapterImage,
  },
}

export const offscreenSiteAdapter: OffscreenSiteAdapter = { offscreen }
