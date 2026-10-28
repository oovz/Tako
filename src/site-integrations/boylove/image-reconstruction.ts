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
import type { BoyloveImageLayout } from "./chapter-reader"

export async function reconstructBoyloveImage(
  buffer: ArrayBuffer,
  mimeType: string,
  layout: BoyloveImageLayout,
  signal: AbortSignal | undefined,
  ledger: OffscreenLiveResourceLedger,
  sourceLease: OffscreenLiveResourceLease
) {
  const leases: OffscreenLiveResourceLease[] = [sourceLease]
  try {
    signal?.throwIfAborted()
    const dimensions = readEncodedImageDimensions(buffer, mimeType, ledger)
    assertDecodedImageWithinLimits(
      dimensions.width,
      dimensions.height,
      "BoyLove"
    )
    if (
      dimensions.width !== layout.width ||
      Math.abs(dimensions.height - layout.height) > 1
    ) {
      throw new ProviderContractError(
        "BoyLove image dimensions do not match its reader page."
      )
    }
    return await withRendererPixelBudget(
      dimensions.width * dimensions.height,
      signal,
      async () => {
        leases.push(
          ledger.reserve(
            dimensions.width * dimensions.height * 8,
            "BoyLove decoded image surfaces"
          )
        )
        const sourceBlobLease = ledger.reserve(
          buffer.byteLength,
          "BoyLove source Blob"
        )
        leases.push(sourceBlobLease)
        const bitmap = await createImageBitmap(
          new Blob([buffer], { type: mimeType })
        )
        sourceBlobLease.release()
        try {
          signal?.throwIfAborted()
          if (
            bitmap.width !== dimensions.width ||
            bitmap.height !== dimensions.height
          )
            throw new ProviderContractError(
              "BoyLove decoded image dimensions changed."
            )
          const canvas = new OffscreenCanvas(
            layout.width,
            Math.floor(layout.height)
          )
          const context = canvas.getContext("2d")
          if (!context)
            throw new ProviderContractError(
              "BoyLove image reconstruction canvas is unavailable."
            )
          context.imageSmoothingEnabled = false
          const stripWidth = Math.floor(layout.width / layout.columns)
          // This is the site's do_mergeImg mapping: short pages reverse vertical
          // strips, with the remainder moved from the left edge to the right.
          if (layout.height >= 4000) {
            context.drawImage(bitmap, 0, 0)
          } else {
            for (let column = 1; column <= layout.columns; column += 1) {
              const last = column === layout.columns
              const width = last
                ? layout.width - stripWidth * (layout.columns - 1)
                : stripWidth
              context.drawImage(
                bitmap,
                last ? 0 : layout.width - stripWidth * column,
                0,
                width,
                layout.height,
                stripWidth * (column - 1),
                0,
                width,
                layout.height
              )
            }
          }
          const blobLease = ledger.reserve(
            Math.max(
              MAX_IMAGE_BYTES,
              layout.width * Math.floor(layout.height) * 4
            ),
            "BoyLove encoded output Blob"
          )
          leases.push(blobLease)
          const blob = await canvas.convertToBlob({ type: "image/png" })
          signal?.throwIfAborted()
          if (blob.size === 0 || blob.size > MAX_IMAGE_BYTES)
            throw new ProviderContractError(
              "BoyLove reconstructed image exceeds the output byte limit."
            )
          blobLease.resize(blob.size)
          const outputLease = ledger.reserve(
            blob.size,
            "BoyLove encoded output buffer"
          )
          leases.push(outputLease)
          const data = await blob.arrayBuffer()
          signal?.throwIfAborted()
          return {
            data,
            mimeType: "image/png",
            liveResourceLease: outputLease.transfer(
              "retained BoyLove reconstructed image"
            ),
          }
        } finally {
          bitmap.close()
        }
      }
    )
  } finally {
    for (const lease of leases) lease.release()
  }
}
