import type {
  OffscreenIntegration,
  OffscreenSiteAdapter,
} from "@/src/types/site-integrations"
import { fetchImageWithStallDetection } from "@/src/runtime/fetch-image"
import {
  assertDecodedImageWithinLimits,
  readEncodedImageDimensions,
} from "@/src/runtime/decoded-image-limits"
import { ChapterImagePlanSchema } from "../chapter-plan"
import { ImageAccessBatch } from "../image-access-batch"
import { ProviderContractError } from "../provider-contract-error"
import { createIntegrationEndpointUrlAssertion } from "../request-policy"
import { fetchCoolmicViewer, parseCoolmicId } from "./api"
import type { CoolmicViewer } from "./contracts"
import { resolveCoolmicDocument } from "./series-dom"

const assertContent = createIntegrationEndpointUrlAssertion(
  "coolmic",
  "coolmic-image"
)
const assertCover = createIntegrationEndpointUrlAssertion(
  "coolmic",
  "coolmic-cover"
)
type ImageAccess = {
  cookies: CoolmicViewer["signed_cookie"]
  remaining: number
}
const access = new ImageAccessBatch<ImageAccess>(
  "Coolmic reader image access has expired"
)

function readImageAccess(viewer: CoolmicViewer, chapterId: string) {
  const images = [...viewer.image_data].sort((a, b) => a.num - b.num)
  const owned = new Map<string, ImageAccess>()
  for (const [index, image] of images.entries()) {
    assertContent(image.path)
    const path = new URL(image.path).pathname
    if (
      image.num !== index ||
      path.split("/")[4] !== chapterId.padStart(9, "0")
    )
      throw new ProviderContractError(
        "Coolmic reader page sequence is incomplete"
      )
    assertDecodedImageWithinLimits(image.width, image.height, "Coolmic")
    const previous = owned.get(image.path)
    owned.set(image.path, {
      cookies: viewer.signed_cookie,
      remaining: (previous?.remaining ?? 0) + 1,
    })
  }
  return { images, owned }
}

function readPolicyEpoch(policy: unknown): number {
  if (!policy || typeof policy !== "object") throw new Error()
  const statement = (
    policy as {
      Statement?: {
        Condition?: { DateLessThan?: { "AWS:EpochTime"?: unknown } }
      }[]
    }
  ).Statement?.[0]
  const epoch = statement?.Condition?.DateLessThan?.["AWS:EpochTime"]
  if (typeof epoch !== "number" || !Number.isSafeInteger(epoch))
    throw new Error()
  return epoch
}

function readAccessExpiration(viewer: CoolmicViewer): number {
  let expiration: number
  try {
    const policy: unknown = JSON.parse(
      atob(
        viewer.signed_cookie["CloudFront-Policy"]
          .replace(/-/g, "+")
          .replace(/_/g, "=")
          .replace(/~/g, "/")
      )
    )
    const epoch = readPolicyEpoch(policy)
    expiration = epoch * 1000
    if (expiration <= Date.now()) throw new Error()
  } catch {
    throw new ProviderContractError(
      "Coolmic image access is invalid or expired"
    )
  }
  return expiration
}

function installAccess(
  viewer: CoolmicViewer,
  chapterId: string,
  signal?: AbortSignal
): string[] {
  signal?.throwIfAborted()
  const { images, owned } = readImageAccess(viewer, chapterId)
  const expiration = readAccessExpiration(viewer)
  access.install(
    owned,
    Math.min(expiration - Date.now(), 24 * 60 * 60 * 1000),
    signal
  )
  return images.map((image) => image.path)
}

type ImageOptions = Parameters<
  OffscreenIntegration["chapter"]["downloadImage"]
>[1]

function imageRequestUrl(imageUrl: string, imageAccess?: ImageAccess): URL {
  const url = new URL(imageUrl)
  if (imageAccess) {
    for (const [key, value] of Object.entries(imageAccess.cookies))
      url.searchParams.set(key.replace("CloudFront-", ""), value)
  }
  return url
}

async function requestImage(
  imageUrl: string,
  opts: ImageOptions,
  imageAccess?: ImageAccess
) {
  const assertUrlAllowed = imageAccess ? assertContent : assertCover
  assertUrlAllowed(imageUrl)
  const url = imageRequestUrl(imageUrl, imageAccess)
  let fetched: Awaited<ReturnType<typeof fetchImageWithStallDetection>>
  try {
    fetched = await fetchImageWithStallDetection(url.href, {
      integrationId: "coolmic",
      endpointId: imageAccess ? "coolmic-image" : "coolmic-cover",
      signal: opts.signal,
      rateLimitService: opts.runtime.rateLimitService,
      rateLimitPolicy: opts.runtime.rateLimitSettings.image,
      skipRateLimit: true,
      onBytesReceived: opts.onBytesReceived,
      assertUrlAllowed,
      liveResourceLedger: opts.liveResourceLedger,
      allowEncodedImageMimeType: true,
      init: { credentials: "omit" },
    })
  } catch (error) {
    opts.signal?.throwIfAborted()
    const failure = new Error("Coolmic image request failed")
    if (error && typeof error === "object" && "status" in error)
      Object.assign(failure, { status: error.status })
    throw failure
  }
  return { fetched, url }
}

function readImageMimeType(buffer: ArrayBuffer): "image/jpeg" | "image/png" {
  const data = new Uint8Array(buffer)
  const isJpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  const isPng =
    data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
  if (!isJpeg && !isPng)
    throw new ProviderContractError("Coolmic returned invalid image content")
  const mimeType = isJpeg ? "image/jpeg" : "image/png"
  return mimeType
}

async function downloadImage(
  imageUrl: string,
  opts: ImageOptions,
  imageAccess?: ImageAccess
) {
  const { fetched, url } = await requestImage(imageUrl, opts, imageAccess)
  try {
    opts.signal?.throwIfAborted()
    const mimeType = readImageMimeType(fetched.data)
    const dimensions = readEncodedImageDimensions(
      fetched.data,
      mimeType,
      opts.liveResourceLedger
    )
    assertDecodedImageWithinLimits(
      dimensions.width,
      dimensions.height,
      "Coolmic"
    )
    access.consume(imageUrl, imageAccess)
    return {
      ...fetched,
      mimeType,
      filename: `${
        url.pathname
          .split("/")
          .pop()
          ?.replace(/\.[^.]*$/, "") || "page"
      }.${mimeType === "image/jpeg" ? "jpg" : "png"}`,
    }
  } catch (error) {
    fetched.liveResourceLease.release()
    throw error
  }
}
const offscreen: OffscreenIntegration = {
  name: "Coolmic Offscreen",
  series: {
    resolveSeriesData(input) {
      return Promise.resolve(
        resolveCoolmicDocument(input.document, input.seriesUrl)
      )
    },
  },
  cover: { downloadImage: (url, opts) => downloadImage(url, opts) },
  chapter: {
    async resolveChapterPlan(chapter, input) {
      const id = parseCoolmicId(chapter.url, "episodes")
      if (chapter.id !== id)
        throw new ProviderContractError("Coolmic episode identity mismatch")
      const viewer = await fetchCoolmicViewer(
        id,
        input.runtime.rateLimitService,
        input.signal
      )
      return ChapterImagePlanSchema.parse({
        imageUrls: installAccess(viewer, id, input.signal),
      })
    },
    async downloadImage(imageUrl, opts) {
      const imageAccess = access.require(imageUrl)
      return downloadImage(imageUrl, opts, imageAccess)
    },
  },
}
export const offscreenSiteAdapter: OffscreenSiteAdapter = { offscreen }
