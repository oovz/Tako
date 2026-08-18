import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
} from "@/src/types/site-integrations"
import { ChapterImagePlanSchema } from "@/src/site-integrations/chapter-plan"
import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"
import { integrationHttpClient } from "@/src/site-integrations/http-client"
import { fetchViewer } from "./api"
import { decryptPageImage, detectImageMimeTypeAndExt } from "./crypto"
import {
  isTrustedMangaMillionAssetUrl,
  parseMangaMillionChapterId,
  parseMangaMillionSeriesUrl,
} from "./urls"

export const offscreen: OffscreenIntegration = {
  name: "MangaMillion Offscreen",
  cover: {
    async downloadImage(imageUrl, opts) {
      if (!isTrustedMangaMillionAssetUrl(imageUrl)) {
        throw new ProviderContractError(
          "Invalid or untrusted MangaMillion cover asset URL."
        )
      }
      if (opts.signal?.aborted) {
        throw new Error("aborted")
      }

      const response = await integrationHttpClient.request({
        integrationId: "mangamillion",
        endpointId: "mangamillion-image",
        url: imageUrl,
        scope: "image",
        rateLimitService: opts.runtime.rateLimitService,
        policyOverride: opts.runtime.rateLimitSettings.image,
        skipRateLimit: true,
        init: {
          credentials: "omit",
          signal: opts.signal,
        },
      })

      if (!response.ok) {
        throw new ProviderContractError(
          `MangaMillion cover download failed (HTTP ${response.status}).`
        )
      }

      const data = await response.arrayBuffer()
      await opts.onBytesReceived?.(data.byteLength)

      const detected = detectImageMimeTypeAndExt(new Uint8Array(data))

      // If the cover is in AVIF format, convert it to JPEG using OffscreenCanvas for CBZ compatibility
      if (
        detected.mimeType === "image/avif" &&
        typeof OffscreenCanvas !== "undefined"
      ) {
        try {
          const blob = new Blob([data], { type: "image/avif" })
          const bitmap = await createImageBitmap(blob)
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
          const ctx = canvas.getContext("2d")
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0)
            const jpegBlob = await canvas.convertToBlob({
              type: "image/jpeg",
              quality: 0.92,
            })
            const jpegData = await jpegBlob.arrayBuffer()
            return {
              data: jpegData,
              filename: "cover.jpg",
              mimeType: "image/jpeg",
            }
          }
        } catch {
          // Fall back to original format if conversion is unavailable
        }
      }

      const headerMime = response.headers.get("content-type")
      const mimeType =
        headerMime && headerMime !== "application/octet-stream"
          ? headerMime
          : detected.mimeType

      const filename =
        new URL(imageUrl).pathname.split("/").filter(Boolean).pop() ||
        `cover${detected.extension}`

      return { data, filename, mimeType }
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

      const response = await integrationHttpClient.request({
        integrationId: "mangamillion",
        endpointId: "mangamillion-image",
        url: rawUrl,
        scope: "image",
        rateLimitService: opts.runtime.rateLimitService,
        policyOverride: opts.runtime.rateLimitSettings.image,
        // Image batches are already scheduled by chapter-image-downloads;
        // re-scheduling here deadlocks the shared rate limiter.
        skipRateLimit: true,
        init: {
          credentials: "omit",
          signal: opts.signal,
        },
      })

      if (!response.ok) {
        throw new ProviderContractError(
          `MangaMillion chapter image download failed (HTTP ${response.status}).`
        )
      }

      const rawData = await response.arrayBuffer()
      await opts.onBytesReceived?.(rawData.byteLength)

      const params = fragment ? new URLSearchParams(fragment) : null
      const aesKey = params?.get("k")
      const aesIv = params?.get("iv")

      let finalData = rawData
      let finalMime: string
      let finalExtension: string
      if (aesKey && aesIv) {
        const decrypted = await decryptPageImage(rawData, aesKey, aesIv)
        finalData = decrypted.data
        finalMime = decrypted.mimeType
        finalExtension = decrypted.extension
      } else {
        const detected = detectImageMimeTypeAndExt(new Uint8Array(rawData))
        finalMime = detected.mimeType
        finalExtension = detected.extension
      }

      const rawFilename =
        new URL(rawUrl).pathname.split("/").filter(Boolean).pop() || "page"
      let cleanFilename = rawFilename.replace(/\.enc$/i, "")

      if (finalExtension && !cleanFilename.endsWith(finalExtension)) {
        cleanFilename =
          cleanFilename.replace(/\.[a-zA-Z0-9]+$/, "") + finalExtension
      }

      return {
        data: finalData,
        filename: cleanFilename,
        mimeType: finalMime,
      }
    },
  },
}

export const offscreenSiteAdapter: OffscreenSiteAdapter = {
  id: "mangamillion",
  offscreen,
}
