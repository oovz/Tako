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
import { ImageAccessBatch } from "../image-access-batch"
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
const access = new ImageAccessBatch<ImageAccess>(
  "MANGA Plus viewer image access has expired"
)

function imageAccessLifetime(url: string, lifetime: number): number {
  const expires = Number(new URL(url).searchParams.get("expires")) * 1000
  if (!Number.isFinite(expires) || expires <= Date.now()) return lifetime
  return Math.max(lifetime, Math.min(expires - Date.now(), 24 * 60 * 60 * 1000))
}

function buildImageAccess(
  images: { url: string; encryptionKey: string }[],
  token: string,
  owned: Map<string, ImageAccess>
): number {
  let lifetime = HARD_TIMEOUT_MS
  for (const image of images) {
    assertIntegrationEndpointRequestUrl(
      "mangaplus",
      "mangaplus-image",
      image.url
    )
    lifetime = imageAccessLifetime(image.url, lifetime)
    const existing = owned.get(image.url)
    if (existing && existing.key !== image.encryptionKey)
      throw new ProviderContractError("Conflicting MANGA Plus image keys")
    owned.set(image.url, {
      key: image.encryptionKey,
      token,
      remaining: (existing?.remaining ?? 0) + 1,
    })
  }
  return lifetime
}

function installAccess(
  images: { url: string; encryptionKey: string }[],
  token: string,
  signal?: AbortSignal
): void {
  access.release()
  const owned = new Map<string, ImageAccess>()
  const lifetime = buildImageAccess(images, token, owned)
  access.install(owned, lifetime, signal)
}

function decodeImageContent(
  buffer: ArrayBuffer,
  imageAccess?: ImageAccess
): "image/jpeg" | "image/png" {
  const data = new Uint8Array(buffer)
  if (imageAccess?.key) {
    const key = Uint8Array.from(imageAccess.key.match(/../g)!, (pair) =>
      Number.parseInt(pair, 16)
    )
    for (let i = 0; i < data.length; i++) data[i] ^= key[i % key.length]
  }
  if ([0xff, 0xd8, 0xff].every((byte, index) => data[index] === byte))
    return "image/jpeg"
  if ([0x89, 0x50, 0x4e, 0x47].every((byte, index) => data[index] === byte))
    return "image/png"
  throw new ProviderContractError("MANGA Plus returned invalid image content")
}

function imageFilename(
  imageUrl: string,
  mimeType: "image/jpeg" | "image/png"
): string {
  const stem =
    new URL(imageUrl).pathname
      .split("/")
      .pop()
      ?.replace(/\.[^.]*$/, "") || "page"
  return `${stem}.${mimeType === "image/jpeg" ? "jpg" : "png"}`
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
    const mimeType = decodeImageContent(fetched.data, imageAccess)
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
    access.consume(imageUrl, imageAccess)
    return {
      ...fetched,
      mimeType,
      filename: imageFilename(imageUrl, mimeType),
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
      const imageAccess = access.require(imageUrl)
      return downloadImage(imageUrl, opts, imageAccess)
    },
  },
}
export const offscreenSiteAdapter: OffscreenSiteAdapter = { offscreen }
