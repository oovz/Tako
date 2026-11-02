import type {
  RuntimeMessageRequest,
  RuntimeMessageResponse,
} from "@/src/runtime/runtime-message-contracts"
import {
  COVER_PREVIEW_TIMEOUT_MS,
  CoverPreviewResponseSchema,
  MAX_COVER_PREVIEW_BYTES,
} from "@/src/runtime/cover-preview-contracts"
import {
  assertDecodedImageWithinLimits,
  readEncodedImageDimensions,
} from "@/src/runtime/decoded-image-limits"
import { OffscreenLiveResourceLedger } from "@/src/runtime/offscreen-live-resource-ledger"
import type { RateLimitService } from "@/src/runtime/rate-limit"
import { offscreenSiteAdaptersById } from "@/src/runtime/generated/site-integration-offscreen-registry"
import { loadOffscreenSiteIntegrationEnablement } from "@/src/runtime/site-integration-offscreen-initialization"
import { getDefinition, isEnabled } from "@/src/site-integrations/catalog"

import type { ChapterDownloadImageResult } from "./chapter-processing-types"

type PreviewPayload =
  RuntimeMessageRequest<"OFFSCREEN_FETCH_COVER_PREVIEW">["payload"]
type PreviewResponse = RuntimeMessageResponse<"OFFSCREEN_FETCH_COVER_PREVIEW">

const MAX_ACTIVE_PREVIEWS = 2
const MAX_PREVIEW_PIXELS = 4 * 1024 * 1024
const unavailable = (): PreviewResponse => ({
  success: false,
  error: "Cover preview is unavailable",
})

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("Cover preview canceled")
      )
    signal.addEventListener("abort", abort, { once: true })
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", abort)
        reject(
          error instanceof Error
            ? error
            : new Error("Cover preview failed", { cause: error })
        )
      }
    )
    if (signal.aborted) abort()
  })
}

function assertPreviewDimensions(width: number, height: number): void {
  assertDecodedImageWithinLimits(width, height, "Cover preview")
  if (width * height > MAX_PREVIEW_PIXELS) {
    throw new Error("Cover preview exceeds its decoded image limit")
  }
}

function encodeBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)))
  }
  return btoa(chunks.join(""))
}

/** Owns bounded preview producers until their transport and decoder settle. */
export class CoverPreviewService {
  private readonly active = new Map<string, AbortController>()

  constructor(
    private readonly rateLimitService: RateLimitService,
    private readonly liveResourceLedger: OffscreenLiveResourceLedger
  ) {}

  async fetch(payload: PreviewPayload): Promise<PreviewResponse> {
    if (
      this.active.size >= MAX_ACTIVE_PREVIEWS ||
      this.active.has(payload.requestId)
    ) {
      return unavailable()
    }
    const controller = new AbortController()
    this.active.set(payload.requestId, controller)
    const timeout = setTimeout(
      () => controller.abort(new Error("Cover preview timed out")),
      COVER_PREVIEW_TIMEOUT_MS
    )
    const operation = this.fetchImage(payload, controller.signal).finally(
      () => {
        clearTimeout(timeout)
        this.active.delete(payload.requestId)
      }
    )
    try {
      return await withAbort(operation, controller.signal)
    } catch {
      return unavailable()
    }
  }

  cancel(requestId: string): boolean {
    const controller = this.active.get(requestId)
    if (!controller || controller.signal.aborted) return false
    controller.abort(new Error("Cover preview canceled"))
    return true
  }

  getActiveCount(): number {
    return this.active.size
  }

  private async fetchImage(
    payload: PreviewPayload,
    signal: AbortSignal
  ): Promise<PreviewResponse> {
    const integration = await this.resolveIntegration(payload, signal)
    const download =
      integration.cover?.downloadImage ?? integration.chapter.downloadImage
    const image = await this.rateLimitService.scheduleForIntegrationScope(
      payload.integrationId,
      "image",
      () => {
        signal.throwIfAborted()
        return download(payload.coverUrl, {
          signal,
          skipRateLimit: true,
          runtime: {
            rateLimitSettings: payload.rateLimitSettings,
            rateLimitService: this.rateLimitService,
          },
          liveResourceLedger: this.liveResourceLedger,
          onBytesReceived(bytes) {
            signal.throwIfAborted()
            if (bytes > MAX_COVER_PREVIEW_BYTES) {
              throw new Error("Cover preview exceeds its encoded image limit")
            }
          },
        })
      },
      payload.rateLimitSettings.image
    )
    try {
      signal.throwIfAborted()
      if (
        image.data.byteLength === 0 ||
        image.data.byteLength > MAX_COVER_PREVIEW_BYTES
      ) {
        throw new Error("Cover preview exceeds its encoded image limit")
      }
      await this.validateDecodedImage(image, signal)
      signal.throwIfAborted()
      const encodingLease = this.liveResourceLedger.reserve(
        image.data.byteLength * 6,
        "cover preview JSON encoding"
      )
      try {
        return CoverPreviewResponseSchema.parse({
          success: true,
          integrationId: payload.integrationId,
          coverUrl: payload.coverUrl,
          mimeType: image.mimeType,
          base64: encodeBase64(image.data),
        })
      } finally {
        encodingLease.release()
      }
    } finally {
      image.liveResourceLease.release()
    }
  }
  private async resolveIntegration(
    payload: PreviewPayload,
    signal: AbortSignal
  ) {
    const enablement = await loadOffscreenSiteIntegrationEnablement()
    signal.throwIfAborted()
    if (
      !getDefinition(payload.integrationId)?.shipped ||
      !isEnabled(payload.integrationId, enablement)
    ) {
      throw new Error("Cover integration is unavailable")
    }
    const integration =
      offscreenSiteAdaptersById[payload.integrationId]?.offscreen
    if (!integration) throw new Error("Cover integration is unavailable")
    return integration
  }

  private async validateDecodedImage(
    image: ChapterDownloadImageResult,
    signal: AbortSignal
  ): Promise<void> {
    const dimensions = readEncodedImageDimensions(
      image.data,
      image.mimeType,
      this.liveResourceLedger
    )
    assertPreviewDimensions(dimensions.width, dimensions.height)
    const decodedLease = this.liveResourceLedger.reserve(
      dimensions.width * dimensions.height * 4,
      "cover preview decoder"
    )
    try {
      const bitmap = await createImageBitmap(
        new Blob([image.data], { type: image.mimeType })
      )
      try {
        signal.throwIfAborted()
        assertPreviewDimensions(bitmap.width, bitmap.height)
      } finally {
        bitmap.close()
      }
    } finally {
      decodedLease.release()
    }
  }
}
