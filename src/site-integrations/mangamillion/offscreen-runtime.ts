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

export const offscreen: OffscreenIntegration = {
  name: "MangaMillion Offscreen",
  cover: {
    async downloadImage(imageUrl, opts): Promise<OwnedImage> {
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
    },
  },
  chapter: {
    async resolveChapterPlan(chapter, input) {
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

      const pages = viewer.pages ?? []
      if (pages.length === 0) {
        throw new ProviderContractError(
          `No pages found in MangaMillion viewer for chapter ${chapterId}.`
        )
      }

      const aesKey = viewer.aesKey ?? ""
      const aesIv = viewer.aesIv ?? ""

      const imageUrls: string[] = []
      for (const page of pages) {
        if (!page.imageUrl) continue
        if (aesKey && aesIv) {
          const fragment = `k=${encodeURIComponent(aesKey)}&iv=${encodeURIComponent(aesIv)}`
          imageUrls.push(`${page.imageUrl}#${fragment}`)
        } else {
          imageUrls.push(page.imageUrl)
        }
      }

      if (imageUrls.length === 0) {
        throw new ProviderContractError(
          `No valid image URLs found for MangaMillion chapter ${chapterId}.`
        )
      }

      return ChapterImagePlanSchema.parse({ imageUrls })
    },

    async downloadImage(imageUrl, opts) {
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
        const rawData = fetched.data

        const params = fragment ? new URLSearchParams(fragment) : null
        const aesKey = params?.get("k")
        const aesIv = params?.get("iv")

        let finalImage: {
          data: ArrayBuffer
          mimeType: string
          extension: string
          liveResourceLease: OffscreenLiveResourceLease
        }
        if (aesKey && aesIv) {
          const decrypted = await decryptPageImage(
            rawData,
            aesKey,
            aesIv,
            opts.liveResourceLedger,
            fetchedLease
          )
          fetchedLease = undefined
          finalImage = await normalizeMangaMillionImage(
            {
              data: decrypted.data,
              mimeType: decrypted.mimeType,
              extension: decrypted.extension,
              liveResourceLease: decrypted.liveResourceLease,
            },
            opts.signal,
            opts.liveResourceLedger
          )
        } else {
          const detected = detectImageMimeTypeAndExt(new Uint8Array(rawData))
          finalImage = await normalizeMangaMillionImage(
            {
              data: rawData,
              mimeType: detected.mimeType,
              extension: detected.extension,
              liveResourceLease: fetchedLease,
            },
            opts.signal,
            opts.liveResourceLedger
          )
          fetchedLease = undefined
        }

        return {
          data: finalImage.data,
          filename: buildMangaMillionImageFilename(
            rawUrl,
            finalImage.extension
          ),
          mimeType: finalImage.mimeType,
          liveResourceLease: finalImage.liveResourceLease,
        }
      } finally {
        fetchedLease?.release()
      }
    },
  },
}

export const offscreenSiteAdapter: OffscreenSiteAdapter = {
  offscreen,
}
