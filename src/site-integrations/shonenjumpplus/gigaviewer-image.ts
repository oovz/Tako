import {
  assertDecodedImageWithinLimits,
  readEncodedImageDimensions,
} from "@/src/runtime/decoded-image-limits"
import { withRendererPixelBudget } from "@/src/runtime/renderer-budget"
import { ProviderContractError } from "../provider-contract-error"
import { MAX_IMAGE_BYTES } from "@/src/constants/timeouts"
import type {
  OffscreenLiveResourceLedger,
  OffscreenLiveResourceLease,
} from "@/src/runtime/offscreen-live-resource-ledger"

const DIVIDE_NUM = 4
const MULTIPLE = 8

export interface GigaviewerTileMove {
  source: { x: number; y: number }
  dest: { x: number; y: number }
}

export function buildGigaviewerTileMoves(
  width: number,
  height: number
): {
  tileWidth: number
  tileHeight: number
  moves: GigaviewerTileMove[]
} {
  const tileWidth = Math.floor(width / (DIVIDE_NUM * MULTIPLE)) * MULTIPLE
  const tileHeight = Math.floor(height / (DIVIDE_NUM * MULTIPLE)) * MULTIPLE
  const moves: GigaviewerTileMove[] = []
  for (let sourceX = 0; sourceX < DIVIDE_NUM; sourceX += 1) {
    for (let sourceY = 0; sourceY < DIVIDE_NUM; sourceY += 1) {
      moves.push({
        source: { x: sourceX, y: sourceY },
        dest: { x: sourceY, y: sourceX },
      })
    }
  }
  return { tileWidth, tileHeight, moves }
}

function outputMimeType(sourceMimeType: string): string {
  return ["image/jpeg", "image/png", "image/webp"].includes(sourceMimeType)
    ? sourceMimeType
    : "image/png"
}

export async function descrambleGigaviewerImage(
  buffer: ArrayBuffer,
  mimeType: string,
  signal?: AbortSignal,
  liveResourceLedger?: OffscreenLiveResourceLedger,
  sourceLease?: OffscreenLiveResourceLease
): Promise<{
  data: ArrayBuffer
  mimeType: string
  liveResourceLease?: OffscreenLiveResourceLease
}> {
  const encodedSourceLease = sourceLease
  let sourceBlobLease: OffscreenLiveResourceLease | undefined
  let decodedSurfaceLease: OffscreenLiveResourceLease | undefined
  let outputBlobLease: OffscreenLiveResourceLease | undefined
  let outputBufferLease: OffscreenLiveResourceLease | undefined
  try {
    if (
      typeof createImageBitmap !== "function" ||
      typeof OffscreenCanvas === "undefined"
    ) {
      throw new ProviderContractError(
        "Shonen Jump+ image reconstruction is unavailable in this browser."
      )
    }
    const dimensions = readEncodedImageDimensions(buffer, mimeType)
    assertDecodedImageWithinLimits(
      dimensions.width,
      dimensions.height,
      "Shonen Jump+"
    )
    return await withRendererPixelBudget(
      dimensions.width * dimensions.height,
      signal,
      async () => {
        decodedSurfaceLease = liveResourceLedger?.reserve(
          dimensions.width * dimensions.height * 8,
          "Shonen Jump+ decoded source and destination surfaces"
        )
        sourceBlobLease = liveResourceLedger?.reserve(
          buffer.byteLength,
          "Shonen Jump+ encoded source Blob"
        )
        const bitmap = await createImageBitmap(
          new Blob([buffer], { type: mimeType })
        )
        sourceBlobLease?.release()
        sourceBlobLease = undefined
        try {
          assertDecodedImageWithinLimits(
            bitmap.width,
            bitmap.height,
            "Shonen Jump+"
          )
          const { tileWidth, tileHeight, moves } = buildGigaviewerTileMoves(
            bitmap.width,
            bitmap.height
          )
          if (tileWidth <= 0 || tileHeight <= 0) {
            throw new ProviderContractError(
              "Shonen Jump+ image is too small to reconstruct safely."
            )
          }

          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
          const context = canvas.getContext("2d")
          if (!context) {
            throw new ProviderContractError(
              "Shonen Jump+ image reconstruction canvas is unavailable."
            )
          }
          context.imageSmoothingEnabled = false
          context.drawImage(
            bitmap,
            0,
            0,
            bitmap.width,
            bitmap.height,
            0,
            0,
            bitmap.width,
            bitmap.height
          )
          for (const move of moves) {
            context.drawImage(
              bitmap,
              move.source.x * tileWidth,
              move.source.y * tileHeight,
              tileWidth,
              tileHeight,
              move.dest.x * tileWidth,
              move.dest.y * tileHeight,
              tileWidth,
              tileHeight
            )
          }

          const finalMimeType = outputMimeType(mimeType)
          outputBlobLease = liveResourceLedger?.reserve(
            Math.max(MAX_IMAGE_BYTES, bitmap.width * bitmap.height * 4),
            "Shonen Jump+ encoded output Blob"
          )
          const output = await canvas.convertToBlob({
            type: finalMimeType,
            quality: finalMimeType === "image/jpeg" ? 0.92 : undefined,
          })
          if (output.size > MAX_IMAGE_BYTES) {
            throw new ProviderContractError(
              `Shonen Jump+ encoded output exceeds ${MAX_IMAGE_BYTES} byte limit (got ${output.size})`
            )
          }
          outputBlobLease?.resize(output.size)
          outputBufferLease = liveResourceLedger?.reserve(
            output.size,
            "Shonen Jump+ encoded output ArrayBuffer"
          )
          const data = await output.arrayBuffer()
          outputBlobLease?.release()
          outputBlobLease = undefined
          const liveResourceLease = outputBufferLease?.transfer(
            "retained Shonen Jump+ encoded output"
          )
          outputBufferLease = undefined
          return {
            data,
            mimeType: output.type || finalMimeType,
            liveResourceLease,
          }
        } finally {
          bitmap.close()
        }
      }
    )
  } finally {
    encodedSourceLease?.release()
    sourceBlobLease?.release()
    decodedSurfaceLease?.release()
    outputBlobLease?.release()
    outputBufferLease?.release()
  }
}
