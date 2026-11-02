import {
  assertDecodedImageWithinLimits,
  readEncodedImageDimensions,
} from "@/src/runtime/decoded-image-limits"
import { withRendererPixelBudget } from "@/src/runtime/renderer-budget"
import { isImageBitmapRenderingAvailable } from "@/src/runtime/image-rendering-capability"
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
    if (this.state.every((value) => value === 0)) {
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

// Bound grid density before allocating the tile mapping.
const MIN_GRID_DIMENSION = 8

// Reject grids whose total cell count exceeds this limit.
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

class PixivReconstructionResources {
  sourceBlob: OffscreenLiveResourceLease | undefined
  decodedSurfaces: OffscreenLiveResourceLease | undefined
  outputBlob: OffscreenLiveResourceLease | undefined
  outputBuffer: OffscreenLiveResourceLease | undefined

  release(sourceLease: OffscreenLiveResourceLease): void {
    sourceLease.release()
    this.sourceBlob?.release()
    this.decodedSurfaces?.release()
    this.outputBlob?.release()
    this.outputBuffer?.release()
  }
}

type PixivReconstructedImage = {
  data: ArrayBuffer
  mimeType: string
  liveResourceLease: OffscreenLiveResourceLease
}

async function decodePixivBitmap(
  buffer: ArrayBuffer,
  mimeType: string,
  ledger: OffscreenLiveResourceLedger,
  resources: PixivReconstructionResources
): Promise<ImageBitmap> {
  resources.sourceBlob = ledger.reserve(
    buffer.byteLength,
    "Pixiv Comic encoded source Blob"
  )
  const bitmap = await createImageBitmap(new Blob([buffer], { type: mimeType }))
  resources.sourceBlob.release()
  resources.sourceBlob = undefined
  return bitmap
}

function resolvePixivGrid(bitmap: ImageBitmap, imageUrl: string) {
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
  return { gridWidth, gridHeight, rows, columns }
}

function drawPixivTiles(
  bitmap: ImageBitmap,
  context: OffscreenCanvasRenderingContext2D,
  grid: ReturnType<typeof resolvePixivGrid>,
  reverseShuffle: number[][]
): void {
  const { gridWidth, gridHeight, rows, columns } = grid
  // Draw from the decoded bitmap to avoid allocating duplicate ImageData surfaces.
  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    const sourceY = rowIndex * gridHeight
    const copyHeight = Math.min(gridHeight, bitmap.height - sourceY)
    // The shuffle table has exactly one complete permutation per grid row.
    const rowShuffle = reverseShuffle[rowIndex]
    for (let column = 0; column < columns; column += 1) {
      const destX = column * gridWidth
      const sourceX = rowShuffle[column] * gridWidth
      context.drawImage(
        bitmap,
        sourceX,
        sourceY,
        gridWidth,
        copyHeight,
        destX,
        sourceY,
        gridWidth,
        copyHeight
      )
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
}

async function reconstructPixivCanvas(
  bitmap: ImageBitmap,
  key: string,
  imageUrl: string
): Promise<OffscreenCanvas> {
  assertDecodedImageWithinLimits(bitmap.width, bitmap.height, "Pixiv Comic")
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext("2d")
  if (!context) {
    throw new ProviderContractError(
      "Pixiv Comic image reconstruction canvas is unavailable."
    )
  }
  const grid = resolvePixivGrid(bitmap, imageUrl)
  const reverseShuffle = await buildPixivReverseShuffleTable(
    grid.rows,
    grid.columns,
    key
  )
  drawPixivTiles(bitmap, context, grid, reverseShuffle)
  return canvas
}

async function encodePixivCanvas(
  canvas: OffscreenCanvas,
  bitmap: ImageBitmap,
  mimeType: string,
  ledger: OffscreenLiveResourceLedger,
  resources: PixivReconstructionResources
): Promise<PixivReconstructedImage> {
  const outputMimeType = mimeType.startsWith("image/") ? mimeType : "image/png"
  const blobLease = ledger.reserve(
    Math.max(MAX_IMAGE_BYTES, bitmap.width * bitmap.height * 4),
    "Pixiv Comic encoded output Blob"
  )
  resources.outputBlob = blobLease
  const outputBlob = await canvas.convertToBlob({
    type: outputMimeType,
    quality: outputMimeType === "image/jpeg" ? 0.92 : undefined,
  })
  if (outputBlob.size > MAX_IMAGE_BYTES) {
    throw new ProviderContractError(
      `Pixiv Comic encoded output exceeds ${MAX_IMAGE_BYTES} byte limit (got ${outputBlob.size})`
    )
  }
  blobLease.resize(outputBlob.size)
  const bufferLease = ledger.reserve(
    outputBlob.size,
    "Pixiv Comic encoded output ArrayBuffer"
  )
  resources.outputBuffer = bufferLease
  const data = await outputBlob.arrayBuffer()
  blobLease.release()
  resources.outputBlob = undefined
  const liveResourceLease = bufferLease.transfer(
    "retained Pixiv Comic encoded output"
  )
  resources.outputBuffer = undefined
  return {
    data,
    mimeType: outputBlob.type || outputMimeType,
    liveResourceLease,
  }
}

export const descramblePixivImage = async (
  buffer: ArrayBuffer,
  mimeType: string,
  key: string,
  imageUrl: string,
  signal: AbortSignal | undefined,
  liveResourceLedger: OffscreenLiveResourceLedger,
  sourceLease: OffscreenLiveResourceLease
): Promise<PixivReconstructedImage> => {
  const resources = new PixivReconstructionResources()
  try {
    if (!isImageBitmapRenderingAvailable()) {
      throw new ProviderContractError(
        "Pixiv Comic image reconstruction is unavailable in this browser."
      )
    }
    const dimensions = readEncodedImageDimensions(
      buffer,
      mimeType,
      liveResourceLedger
    )
    assertDecodedImageWithinLimits(
      dimensions.width,
      dimensions.height,
      "Pixiv Comic"
    )
    return await withRendererPixelBudget(
      dimensions.width * dimensions.height,
      signal,
      async () => {
        resources.decodedSurfaces = liveResourceLedger.reserve(
          dimensions.width * dimensions.height * 8,
          "Pixiv Comic decoded source and destination surfaces"
        )
        const bitmap = await decodePixivBitmap(
          buffer,
          mimeType,
          liveResourceLedger,
          resources
        )
        try {
          const canvas = await reconstructPixivCanvas(bitmap, key, imageUrl)
          return await encodePixivCanvas(
            canvas,
            bitmap,
            mimeType,
            liveResourceLedger,
            resources
          )
        } finally {
          bitmap.close()
        }
      }
    )
  } finally {
    resources.release(sourceLease)
  }
}
