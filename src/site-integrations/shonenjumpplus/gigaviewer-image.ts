import {
  assertDecodedImageWithinLimits,
  readEncodedImageDimensions,
} from "@/src/runtime/decoded-image-limits"

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
  mimeType: string
): Promise<{ data: ArrayBuffer; mimeType: string }> {
  if (
    typeof createImageBitmap !== "function" ||
    typeof OffscreenCanvas === "undefined"
  ) {
    throw new Error(
      "Shonen Jump+ image reconstruction is unavailable in this browser."
    )
  }

  const dimensions = readEncodedImageDimensions(buffer, mimeType)
  assertDecodedImageWithinLimits(
    dimensions.width,
    dimensions.height,
    "Shonen Jump+"
  )
  const bitmap = await createImageBitmap(new Blob([buffer], { type: mimeType }))
  try {
    assertDecodedImageWithinLimits(bitmap.width, bitmap.height, "Shonen Jump+")
    const { tileWidth, tileHeight, moves } = buildGigaviewerTileMoves(
      bitmap.width,
      bitmap.height
    )
    if (tileWidth <= 0 || tileHeight <= 0) {
      throw new Error("Shonen Jump+ image is too small to reconstruct safely.")
    }

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext("2d")
    if (!context) {
      throw new Error(
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
    const output = await canvas.convertToBlob({
      type: finalMimeType,
      quality: finalMimeType === "image/jpeg" ? 0.92 : undefined,
    })
    return {
      data: await output.arrayBuffer(),
      mimeType: output.type || finalMimeType,
    }
  } finally {
    bitmap.close()
  }
}
