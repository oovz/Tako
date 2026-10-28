import { MAX_IMAGE_BYTES } from "@/src/constants/timeouts"
import {
  assertDecodedImageWithinLimits,
  readEncodedImageDimensions,
} from "@/src/runtime/decoded-image-limits"
import { withRendererPixelBudget } from "@/src/runtime/renderer-budget"
import type {
  OffscreenLiveResourceLedger,
  OffscreenLiveResourceLease,
} from "@/src/runtime/offscreen-live-resource-ledger"
import { ProviderContractError } from "../provider-contract-error"

export function parseMangagoImageTransport(imageUrl: string): {
  sourceUrl: string
  columns?: number
  grid?: number[]
} {
  const url = new URL(imageUrl)
  const fragment = url.hash
  url.hash = ""
  if (!fragment) {
    if (url.pathname.startsWith("/r/cspiclink/"))
      throw new ProviderContractError(
        "Mangago scrambled image is missing its tile order"
      )
    return { sourceUrl: url.href }
  }
  const match = fragment.match(/^#mg-grid=(\d+):([\d,]+)$/)
  const columns = Number(match?.[1])
  const grid = match?.[2]?.split(",").map(Number)
  if (
    !match ||
    !url.pathname.startsWith("/r/cspiclink/") ||
    !Number.isInteger(columns) ||
    columns < 1 ||
    columns > 16 ||
    !grid ||
    grid.length !== columns * columns ||
    new Set(grid).size !== grid.length ||
    grid.some(
      (entry) => !Number.isInteger(entry) || entry < 0 || entry >= grid.length
    )
  )
    throw new ProviderContractError("Mangago image tile metadata is invalid")
  return { sourceUrl: url.href, columns, grid }
}

export async function reconstructMangagoImage(
  buffer: ArrayBuffer,
  mimeType: string,
  columns: number,
  grid: number[],
  signal: AbortSignal | undefined,
  ledger: OffscreenLiveResourceLedger,
  sourceLease: OffscreenLiveResourceLease
): Promise<{
  data: ArrayBuffer
  mimeType: string
  liveResourceLease: OffscreenLiveResourceLease
}> {
  let bitmap: ImageBitmap | undefined
  let sourceBlobLease: OffscreenLiveResourceLease | undefined
  let surfaces: OffscreenLiveResourceLease | undefined
  let outputBlobLease: OffscreenLiveResourceLease | undefined
  let outputLease: OffscreenLiveResourceLease | undefined
  try {
    const dimensions = readEncodedImageDimensions(buffer, mimeType, ledger)
    assertDecodedImageWithinLimits(
      dimensions.width,
      dimensions.height,
      "Mangago"
    )
    const pixels = dimensions.width * dimensions.height
    return await withRendererPixelBudget(pixels, signal, async () => {
      signal?.throwIfAborted()
      sourceBlobLease = ledger.reserve(
        buffer.byteLength,
        "Mangago source image Blob"
      )
      surfaces = ledger.reserve(
        pixels * 8,
        "Mangago decoded image and tile surface"
      )
      bitmap = await createImageBitmap(new Blob([buffer], { type: mimeType }))
      sourceBlobLease.release()
      sourceBlobLease = undefined
      if (
        bitmap.width !== dimensions.width ||
        bitmap.height !== dimensions.height
      )
        throw new ProviderContractError(
          "Mangago image dimensions changed during decode"
        )
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext("2d")
      if (!context)
        throw new ProviderContractError("Mangago image canvas is unavailable")
      const width = bitmap.width / columns
      const height = bitmap.height / columns
      for (const [source, destination] of grid.entries()) {
        signal?.throwIfAborted()
        context.drawImage(
          bitmap,
          (source % columns) * width,
          Math.floor(source / columns) * height,
          width,
          height,
          (destination % columns) * width,
          Math.floor(destination / columns) * height,
          width,
          height
        )
      }
      outputBlobLease = ledger.reserve(
        Math.max(MAX_IMAGE_BYTES, pixels * 4),
        "Mangago reconstructed image Blob"
      )
      const blob = await canvas.convertToBlob({ type: "image/png" })
      if (blob.size > MAX_IMAGE_BYTES)
        throw new ProviderContractError(
          "Mangago reconstructed image exceeds its byte limit"
        )
      outputBlobLease.resize(blob.size)
      signal?.throwIfAborted()
      outputLease = ledger.reserve(
        blob.size,
        "Mangago reconstructed image bytes"
      )
      const data = await blob.arrayBuffer()
      const liveResourceLease = outputLease.transfer(
        "retained Mangago reconstructed image"
      )
      outputLease = undefined
      return { data, mimeType: "image/png", liveResourceLease }
    })
  } finally {
    sourceLease.release()
    try {
      bitmap?.close()
    } finally {
      sourceBlobLease?.release()
      surfaces?.release()
      outputBlobLease?.release()
      outputLease?.release()
    }
  }
}
