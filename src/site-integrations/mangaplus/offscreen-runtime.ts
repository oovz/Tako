import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
} from "@/src/types/site-integrations"
import { HARD_TIMEOUT_MS } from "@/src/constants/timeouts"
import {
  assertDecodedImageWithinLimits,
  readEncodedImageDimensions,
} from "@/src/runtime/decoded-image-limits"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"
import { ChapterImagePlanSchema } from "../chapter-plan"
import { ProviderContractError } from "../provider-contract-error"
import {
  assertIntegrationEndpointRequestUrl,
  createIntegrationEndpointUrlAssertion,
} from "../request-policy"
import { fetchMangaPlusViewer, parseMangaPlusId } from "./api"

const assertImage = createIntegrationEndpointUrlAssertion(
  "mangaplus",
  "mangaplus-image"
)
type ImageAccess = { key: string; token: string; remaining: number }
let access = new Map<string, ImageAccess>()
let releaseAccess = () => {}

function installAccess(
  images: { url: string; encryptionKey: string }[],
  token: string,
  signal?: AbortSignal
): void {
  releaseAccess()
  const owned = new Map<string, ImageAccess>()
  let lifetime = HARD_TIMEOUT_MS
  for (const image of images) {
    assertIntegrationEndpointRequestUrl(
      "mangaplus",
      "mangaplus-image",
      image.url
    )
    const expires =
      Number(new URL(image.url).searchParams.get("expires")) * 1000
    if (Number.isFinite(expires) && expires > Date.now())
      lifetime = Math.max(
        lifetime,
        Math.min(expires - Date.now(), 24 * 60 * 60 * 1000)
      )
    const existing = owned.get(image.url)
    if (existing && existing.key !== image.encryptionKey)
      throw new ProviderContractError("Conflicting MANGA Plus image keys")
    owned.set(image.url, {
      key: image.encryptionKey,
      token,
      remaining: (existing?.remaining ?? 0) + 1,
    })
  }
  access = owned
  const cleanup = () => {
    owned.clear()
    clearTimeout(timer)
    signal?.removeEventListener("abort", cleanup)
  }
  const timer = setTimeout(cleanup, lifetime)
  signal?.addEventListener("abort", cleanup, { once: true })
  releaseAccess = cleanup
  if (signal?.aborted) cleanup()
}

async function downloadImage(
  imageUrl: string,
  opts: Parameters<OffscreenIntegration["chapter"]["downloadImage"]>[1],
  imageAccess?: ImageAccess
) {
  assertImage(imageUrl)
  const fetched = await fetchImageWithStallDetection(imageUrl, {
    integrationId: "mangaplus",
    endpointId: "mangaplus-image",
    signal: opts.signal,
    rateLimitService: opts.runtime.rateLimitService,
    rateLimitPolicy: opts.runtime.rateLimitSettings.image,
    skipRateLimit: true,
    onBytesReceived: opts.onBytesReceived,
    assertUrlAllowed: assertImage,
    liveResourceLedger: opts.liveResourceLedger,
    allowEncodedImageMimeType: true,
    init: {
      credentials: "omit",
      headers: imageAccess ? { "Plus-Vw-Token": imageAccess.token } : undefined,
    },
  })
  try {
    opts.signal?.throwIfAborted()
    const data = new Uint8Array(fetched.data)
    if (imageAccess?.key) {
      const key = Uint8Array.from(imageAccess.key.match(/../g)!, (pair) =>
        Number.parseInt(pair, 16)
      )
      for (let i = 0; i < data.length; i++) data[i] ^= key[i % key.length]
    }
    const isJpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
    const isPng =
      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47
    if (!isJpeg && !isPng)
      throw new ProviderContractError(
        "MANGA Plus returned invalid image content"
      )
    const mimeType = isJpeg ? "image/jpeg" : "image/png"
    const dimensions = readEncodedImageDimensions(
      fetched.data,
      mimeType,
      opts.liveResourceLedger
    )
    assertDecodedImageWithinLimits(
      dimensions.width,
      dimensions.height,
      "MANGA Plus"
    )
    if (imageAccess && --imageAccess.remaining === 0) {
      access.delete(imageUrl)
      if (!access.size) releaseAccess()
    }
    return {
      ...fetched,
      mimeType,
      filename: `${
        new URL(imageUrl).pathname
          .split("/")
          .pop()
          ?.replace(/\.[^.]*$/, "") || "page"
      }.${isJpeg ? "jpg" : "png"}`,
    }
  } catch (error) {
    fetched.liveResourceLease.release()
    throw error
  }
}

const offscreen: OffscreenIntegration = {
  name: "MANGA Plus Offscreen",
  cover: { downloadImage: (url, opts) => downloadImage(url, opts) },
  chapter: {
    async resolveChapterPlan(chapter, input) {
      const id = parseMangaPlusId(chapter.url, "viewer")
      if (id !== chapter.id)
        throw new ProviderContractError("MANGA Plus chapter identity mismatch")
      const viewer = await fetchMangaPlusViewer(
        id,
        input.runtime.rateLimitService,
        input.signal
      )
      if (String(viewer.chapterId) !== id)
        throw new ProviderContractError(
          "MANGA Plus returned a different chapter"
        )
      for (const image of viewer.images)
        assertDecodedImageWithinLimits(image.width, image.height, "MANGA Plus")
      const plan = ChapterImagePlanSchema.parse({
        imageUrls: viewer.images.map((image) => image.url),
      })
      installAccess(viewer.images, viewer.viewerToken, input.signal)
      return plan
    },
    async downloadImage(imageUrl, opts) {
      const imageAccess = access.get(imageUrl)
      if (!imageAccess)
        throw new ProviderContractError(
          "MANGA Plus viewer image access has expired"
        )
      return downloadImage(imageUrl, opts, imageAccess)
    },
  },
}
export const offscreenSiteAdapter: OffscreenSiteAdapter = { offscreen }
