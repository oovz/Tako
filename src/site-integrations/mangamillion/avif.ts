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
import { isImageBitmapRenderingAvailable } from "@/src/runtime/image-rendering-capability"
import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"

export type ConvertedAvifImage = {
  data: ArrayBuffer
  mimeType: "image/jpeg"
  liveResourceLease: OffscreenLiveResourceLease
}

function assertConversionAvailable(): void {
  if (!isImageBitmapRenderingAvailable()) {
    throw new ProviderContractError(
      "MangaMillion AVIF conversion is unavailable in this browser."
    )
  }
}

function throwIfConversionAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("aborted")
  }
}

type ConversionResources = {
  sourceBlob?: OffscreenLiveResourceLease
  surface?: OffscreenLiveResourceLease
  outputBlob?: OffscreenLiveResourceLease
  outputBuffer?: OffscreenLiveResourceLease
  bitmap?: ImageBitmap
}

async function decodeAvifBitmap(
  buffer: ArrayBuffer,
  width: number,
  height: number,
  ledger: OffscreenLiveResourceLedger,
  resources: ConversionResources
): Promise<ImageBitmap> {
  resources.sourceBlob = ledger.reserve(
    buffer.byteLength,
    "MangaMillion AVIF encoded source Blob"
  )
  resources.surface = ledger.reserve(
    width * height * 8,
    "MangaMillion AVIF decoded source and destination surfaces"
  )
  resources.bitmap = await createImageBitmap(
    new Blob([buffer], { type: "image/avif" })
  )
  resources.sourceBlob.release()
  resources.sourceBlob = undefined
  return resources.bitmap
}

function createConversionCanvas(
  bitmap: ImageBitmap,
  width: number,
  height: number
): OffscreenCanvas {
  assertDecodedImageWithinLimits(
    bitmap.width,
    bitmap.height,
    "MangaMillion AVIF"
  )
  if (bitmap.width !== width || bitmap.height !== height) {
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
  return canvas
}

async function encodeJpeg(
  canvas: OffscreenCanvas,
  signal: AbortSignal | undefined,
  ledger: OffscreenLiveResourceLedger,
  pixels: number,
  resources: ConversionResources
): Promise<ConvertedAvifImage> {
  resources.outputBlob = ledger.reserve(
    Math.max(MAX_IMAGE_BYTES, pixels * 4),
    "MangaMillion AVIF encoded output Blob"
  )
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 })
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new ProviderContractError(
      `MangaMillion AVIF output exceeds ${MAX_IMAGE_BYTES} byte limit (got ${blob.size})`
    )
  }
  resources.outputBlob.resize(blob.size)
  throwIfConversionAborted(signal)
  resources.outputBuffer = ledger.reserve(
    blob.size,
    "MangaMillion AVIF encoded output ArrayBuffer"
  )
  const data = await blob.arrayBuffer()
  resources.outputBlob.release()
  resources.outputBlob = undefined
  const liveResourceLease = resources.outputBuffer.transfer(
    "retained MangaMillion AVIF JPEG output"
  )
  resources.outputBuffer = undefined
  return { data, mimeType: "image/jpeg", liveResourceLease }
}

async function renderAvif(
  buffer: ArrayBuffer,
  width: number,
  height: number,
  signal: AbortSignal | undefined,
  ledger: OffscreenLiveResourceLedger,
  resources: ConversionResources
): Promise<ConvertedAvifImage> {
  throwIfConversionAborted(signal)
  const bitmap = await decodeAvifBitmap(
    buffer,
    width,
    height,
    ledger,
    resources
  )
  const canvas = createConversionCanvas(bitmap, width, height)
  return encodeJpeg(canvas, signal, ledger, width * height, resources)
}

function releaseConversionResources(
  sourceLease: OffscreenLiveResourceLease,
  resources: ConversionResources
): void {
  sourceLease.release()
  try {
    resources.bitmap?.close()
  } finally {
    resources.sourceBlob?.release()
    resources.surface?.release()
    resources.outputBlob?.release()
    resources.outputBuffer?.release()
  }
}

/** Consumes the AVIF source lease; the returned lease owns the JPEG bytes. */
export async function convertMangaMillionAvifToJpeg(
  buffer: ArrayBuffer,
  signal: AbortSignal | undefined,
  liveResourceLedger: OffscreenLiveResourceLedger,
  sourceLease: OffscreenLiveResourceLease
): Promise<ConvertedAvifImage> {
  const resources: ConversionResources = {}
  try {
    assertConversionAvailable()
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
    return await withRendererPixelBudget(
      dimensions.width * dimensions.height,
      signal,
      () =>
        renderAvif(
          buffer,
          dimensions.width,
          dimensions.height,
          signal,
          liveResourceLedger,
          resources
        )
    )
  } finally {
    releaseConversionResources(sourceLease, resources)
  }
}
