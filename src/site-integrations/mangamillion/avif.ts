import { MAX_IMAGE_BYTES } from "@/src/constants/timeouts"
import {
  assertDecodedImageWithinLimits,
  readEncodedImageDimensions,
} from "@/src/runtime/decoded-image-limits"
import {
  OffscreenLiveResourceLedger,
  type OffscreenLiveResourceLease,
} from "@/src/runtime/offscreen-live-resource-ledger"
import { withRendererPixelBudget } from "@/src/runtime/renderer-budget"
import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"

export type ConvertedAvifImage = {
  data: ArrayBuffer
  mimeType: "image/jpeg"
  liveResourceLease: OffscreenLiveResourceLease
}

/**
 * Converts an AVIF image after bounded metadata admission and before any
 * consumer receives the resulting bytes. The input lease is consumed by this
 * operation; the returned lease owns the JPEG buffer.
 */
export async function convertMangaMillionAvifToJpeg(
  buffer: ArrayBuffer,
  signal: AbortSignal | undefined,
  liveResourceLedger: OffscreenLiveResourceLedger,
  sourceLease: OffscreenLiveResourceLease
): Promise<ConvertedAvifImage> {
  let sourceBlobLease: OffscreenLiveResourceLease | undefined
  let decodedSurfaceLease: OffscreenLiveResourceLease | undefined
  let outputBlobLease: OffscreenLiveResourceLease | undefined
  let outputBufferLease: OffscreenLiveResourceLease | undefined
  let bitmap: ImageBitmap | undefined

  try {
    if (
      typeof createImageBitmap !== "function" ||
      typeof OffscreenCanvas === "undefined"
    ) {
      throw new ProviderContractError(
        "MangaMillion AVIF conversion is unavailable in this browser."
      )
    }

    const dimensions = readEncodedImageDimensions(
      buffer,
      "image/avif",
      liveResourceLedger
    )
    assertDecodedImageWithinLimits(
      dimensions.width,
      dimensions.height,
      "MangaMillion AVIF"
    )
    const pixels = dimensions.width * dimensions.height

    return await withRendererPixelBudget(pixels, signal, async () => {
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error("aborted")
      }

      sourceBlobLease = liveResourceLedger.reserve(
        buffer.byteLength,
        "MangaMillion AVIF encoded source Blob"
      )
      decodedSurfaceLease = liveResourceLedger.reserve(
        pixels * 8,
        "MangaMillion AVIF decoded source and destination surfaces"
      )

      const sourceBlob = new Blob([buffer], { type: "image/avif" })
      bitmap = await createImageBitmap(sourceBlob)
      sourceBlobLease.release()
      sourceBlobLease = undefined

      assertDecodedImageWithinLimits(
        bitmap.width,
        bitmap.height,
        "MangaMillion AVIF"
      )
      if (
        bitmap.width !== dimensions.width ||
        bitmap.height !== dimensions.height
      ) {
        throw new ProviderContractError(
          "MangaMillion AVIF dimensions changed during decode."
        )
      }

      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext("2d")
      if (!context) {
        throw new ProviderContractError(
          "MangaMillion AVIF conversion canvas is unavailable."
        )
      }
      context.drawImage(bitmap, 0, 0)

      outputBlobLease = liveResourceLedger.reserve(
        Math.max(MAX_IMAGE_BYTES, pixels * 4),
        "MangaMillion AVIF encoded output Blob"
      )
      const outputBlob = await canvas.convertToBlob({
        type: "image/jpeg",
        quality: 0.92,
      })
      if (outputBlob.size > MAX_IMAGE_BYTES) {
        throw new ProviderContractError(
          `MangaMillion AVIF output exceeds ${MAX_IMAGE_BYTES} byte limit (got ${outputBlob.size})`
        )
      }
      outputBlobLease.resize(outputBlob.size)
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error("aborted")
      }

      outputBufferLease = liveResourceLedger.reserve(
        outputBlob.size,
        "MangaMillion AVIF encoded output ArrayBuffer"
      )
      const data = await outputBlob.arrayBuffer()
      outputBlobLease.release()
      outputBlobLease = undefined
      const liveResourceLease = outputBufferLease.transfer(
        "retained MangaMillion AVIF JPEG output"
      )
      outputBufferLease = undefined
      return { data, mimeType: "image/jpeg", liveResourceLease }
    })
  } finally {
    sourceLease.release()
    try {
      bitmap?.close()
    } finally {
      sourceBlobLease?.release()
      decodedSurfaceLease?.release()
      outputBlobLease?.release()
      outputBufferLease?.release()
    }
  }
}
