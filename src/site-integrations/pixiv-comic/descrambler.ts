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

const PIXIV_DESCRAMBLE_MAGIC_KEY = "4wXCKprMMoxnyJ3PocJFs4CYbfnbazNe"

const rotateLeft = (value: number, shift: number): number => {
  const normalized = shift % 32
  return ((value << normalized) >>> 0) | (value >>> (32 - normalized))
}

class PixivShuffler {
  private state: Uint32Array

  constructor(seed: Uint32Array) {
    if (seed.length !== 4) {
      throw new ProviderContractError(
        `seed.length !== 4 (seed.length: ${seed.length})`
      )
    }

    this.state = new Uint32Array(seed)
    if (
      this.state[0] === 0 &&
      this.state[1] === 0 &&
      this.state[2] === 0 &&
      this.state[3] === 0
    ) {
      this.state[0] = 1
    }
  }

  next(): number {
    const result = (9 * rotateLeft((5 * this.state[1]) >>> 0, 7)) >>> 0
    const temp = (this.state[1] << 9) >>> 0

    this.state[2] = (this.state[2] ^ this.state[0]) >>> 0
    this.state[3] = (this.state[3] ^ this.state[1]) >>> 0
    this.state[1] = (this.state[1] ^ this.state[2]) >>> 0
    this.state[0] = (this.state[0] ^ this.state[3]) >>> 0
    this.state[2] = (this.state[2] ^ temp) >>> 0
    this.state[3] = rotateLeft(this.state[3], 11) >>> 0

    return result
  }
}

// Minimum pixel cell size for gridshuffle descrambling. Pixiv Comic uses 32:32
// (each cell is 32×32 px). Smaller values create more cells — gridshuffle1:1 on a
// 2000×3000 image would produce 6M cells and OOM the offscreen document. This floor
// allows finer grids if Pixiv ever ships them while preventing DoS.
const MIN_GRID_DIMENSION = 8

// Backstop: reject descrambling if total cell count exceeds this threshold.
// With 32:32 on a 2000×3000 image → ~5,900 cells (well under cap).
// With 8:8 on a 2000×3000 image → ~93,750 cells (over cap → skip).
const MAX_TOTAL_CELLS = 50_000

const parseGridSizeFromImageUrl = (
  imageUrl: string
): { gridWidth: number; gridHeight: number } => {
  const match = imageUrl.match(/gridshuffle(\d+):(\d+)/i)
  const parsedWidth = Number(match?.[1])
  const parsedHeight = Number(match?.[2])

  const gridWidth = Math.max(
    Number.isFinite(parsedWidth) && parsedWidth > 0 ? parsedWidth : 32,
    MIN_GRID_DIMENSION
  )
  const gridHeight = Math.max(
    Number.isFinite(parsedHeight) && parsedHeight > 0 ? parsedHeight : 32,
    MIN_GRID_DIMENSION
  )
  return { gridWidth, gridHeight }
}

const createPixivSeed = async (key: string): Promise<Uint32Array> => {
  if (!globalThis.crypto?.subtle) {
    throw new ProviderContractError(
      "Web Crypto subtle API is required for Pixiv image descrambling"
    )
  }

  const input = `${PIXIV_DESCRAMBLE_MAGIC_KEY}${key}`
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  )
  const bytes = new Uint8Array(digest)
  const seedBytes = bytes.slice(0, 16)
  return new Uint32Array(
    seedBytes.buffer.slice(
      seedBytes.byteOffset,
      seedBytes.byteOffset + seedBytes.byteLength
    )
  )
}

const buildPixivReverseShuffleTable = async (
  rows: number,
  columns: number,
  key: string
): Promise<number[][]> => {
  const table = Array.from({ length: rows }, () =>
    Array.from({ length: columns }, (_, index) => index)
  )
  const seed = await createPixivSeed(key)
  const shuffler = new PixivShuffler(seed)

  for (let step = 0; step < 100; step += 1) {
    shuffler.next()
  }

  for (let row = 0; row < rows; row += 1) {
    const current = table[row]
    for (let index = columns - 1; index >= 1; index -= 1) {
      const swapIndex = shuffler.next() % (index + 1)
      const temp = current[index]
      current[index] = current[swapIndex]
      current[swapIndex] = temp
    }
  }

  for (let row = 0; row < rows; row += 1) {
    const shuffled = table[row]
    const reversed = shuffled.map((_, index) => shuffled.indexOf(index))
    table[row] = reversed
  }

  return table
}

export const descramblePixivImage = async (
  buffer: ArrayBuffer,
  mimeType: string,
  key: string,
  imageUrl: string,
  signal?: AbortSignal,
  liveResourceLedger?: OffscreenLiveResourceLedger,
  sourceLease?: OffscreenLiveResourceLease
): Promise<{
  data: ArrayBuffer
  mimeType: string
  liveResourceLease?: OffscreenLiveResourceLease
}> => {
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
        "Pixiv Comic image reconstruction is unavailable in this browser."
      )
    }
    const dimensions = readEncodedImageDimensions(buffer, mimeType)
    assertDecodedImageWithinLimits(
      dimensions.width,
      dimensions.height,
      "Pixiv Comic"
    )
    return await withRendererPixelBudget(
      dimensions.width * dimensions.height,
      signal,
      async () => {
        decodedSurfaceLease = liveResourceLedger?.reserve(
          dimensions.width * dimensions.height * 8,
          "Pixiv Comic decoded source and destination surfaces"
        )
        sourceBlobLease = liveResourceLedger?.reserve(
          buffer.byteLength,
          "Pixiv Comic encoded source Blob"
        )
        const sourceBlob = new Blob([buffer], { type: mimeType })
        const bitmap = await createImageBitmap(sourceBlob)
        sourceBlobLease?.release()
        sourceBlobLease = undefined

        try {
          assertDecodedImageWithinLimits(
            bitmap.width,
            bitmap.height,
            "Pixiv Comic"
          )
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
          const context = canvas.getContext("2d")
          if (!context) {
            throw new ProviderContractError(
              "Pixiv Comic image reconstruction canvas is unavailable."
            )
          }

          const { gridWidth, gridHeight } = parseGridSizeFromImageUrl(imageUrl)
          const rows = Math.ceil(bitmap.height / gridHeight)
          const columns = Math.floor(bitmap.width / gridWidth)

          if (rows <= 0 || columns <= 0) {
            throw new ProviderContractError(
              "Pixiv Comic image is too small to reconstruct safely."
            )
          }

          const totalCells = rows * columns
          if (totalCells > MAX_TOTAL_CELLS) {
            throw new ProviderContractError(
              `Pixiv descrambling safety cap exceeded (${totalCells} cells; maximum ${MAX_TOTAL_CELLS})`
            )
          }

          const reverseShuffle = await buildPixivReverseShuffleTable(
            rows,
            columns,
            key
          )
          // Draw shuffled tiles directly from the decoded bitmap into the output
          // canvas. Keeping source/target ImageData copies here doubles the largest
          // renderer allocation for every Pixiv page.
          for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
            const sourceY = rowIndex * gridHeight
            const copyHeight = Math.min(gridHeight, bitmap.height - sourceY)
            const rowShuffle = reverseShuffle[rowIndex]
            if (!rowShuffle) {
              continue
            }

            for (let column = 0; column < columns; column += 1) {
              const sourceColumn = rowShuffle[column] ?? column
              const destX = column * gridWidth
              const sourceX = sourceColumn * gridWidth
              const copyWidth = Math.min(
                gridWidth,
                bitmap.width - destX,
                bitmap.width - sourceX
              )
              if (copyWidth > 0 && copyHeight > 0) {
                context.drawImage(
                  bitmap,
                  sourceX,
                  sourceY,
                  copyWidth,
                  copyHeight,
                  destX,
                  sourceY,
                  copyWidth,
                  copyHeight
                )
              }
            }

            const overflowStartX = columns * gridWidth
            if (overflowStartX < bitmap.width) {
              const overflowWidth = bitmap.width - overflowStartX
              context.drawImage(
                bitmap,
                overflowStartX,
                sourceY,
                overflowWidth,
                copyHeight,
                overflowStartX,
                sourceY,
                overflowWidth,
                copyHeight
              )
            }
          }

          const outputMimeType = mimeType.startsWith("image/")
            ? mimeType
            : "image/png"
          outputBlobLease = liveResourceLedger?.reserve(
            Math.max(MAX_IMAGE_BYTES, bitmap.width * bitmap.height * 4),
            "Pixiv Comic encoded output Blob"
          )
          const outputBlob = await canvas.convertToBlob({
            type: outputMimeType,
            quality: outputMimeType === "image/jpeg" ? 0.92 : undefined,
          })
          if (outputBlob.size > MAX_IMAGE_BYTES) {
            throw new ProviderContractError(
              `Pixiv Comic encoded output exceeds ${MAX_IMAGE_BYTES} byte limit (got ${outputBlob.size})`
            )
          }
          outputBlobLease?.resize(outputBlob.size)
          outputBufferLease = liveResourceLedger?.reserve(
            outputBlob.size,
            "Pixiv Comic encoded output ArrayBuffer"
          )
          const data = await outputBlob.arrayBuffer()
          outputBlobLease?.release()
          outputBlobLease = undefined
          const liveResourceLease = outputBufferLease?.transfer(
            "retained Pixiv Comic encoded output"
          )
          outputBufferLease = undefined
          return {
            data,
            mimeType: outputBlob.type || outputMimeType,
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
