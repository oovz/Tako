import {
  assertDecodedImageWithinLimits,
  readEncodedImageDimensions,
} from "@/src/runtime/decoded-image-limits"
import { withRendererPixelBudget } from "@/src/runtime/renderer-budget"
import { isImageBitmapRenderingAvailable } from "@/src/runtime/image-rendering-capability"
import { ProviderContractError } from "../provider-contract-error"
import {
  MAX_DECODED_IMAGE_PIXELS,
  MAX_IMAGE_BYTES,
} from "@/src/constants/timeouts"
import type {
  OffscreenLiveResourceLedger,
  OffscreenLiveResourceLease,
} from "@/src/runtime/offscreen-live-resource-ledger"

export type PublusImageMetadata = {
  mode: number
  seed1: number
  seed2: number
  seed3: number
  tileWidth: number
  tileHeight: number
}

export type PublusTileRect = {
  srcX: number
  srcY: number
  destX: number
  destY: number
  width: number
  height: number
}

export type PublusPageTileRectInput = PublusImageMetadata & {
  sourceWidth: number
  sourceHeight: number
}

const PUBLUS_METADATA_FRAGMENT_KEY = "tmdPublus"
const PUBLUS_RANDOM_SEED = 2463534242
// Ported from the official PUBLUS NFBR.b9n.a3f helper used by Comic Nettai's viewer.
const PUBLUS_RANDOM_PARAMS = [
  [1, 3, 10],
  [1, 5, 16],
  [1, 5, 19],
  [1, 9, 29],
  [1, 11, 6],
  [1, 11, 16],
  [1, 19, 3],
  [1, 21, 20],
  [1, 27, 27],
  [2, 5, 15],
  [2, 5, 21],
  [2, 7, 7],
  [2, 7, 9],
  [2, 7, 25],
  [2, 9, 15],
  [2, 15, 17],
  [2, 15, 25],
  [2, 21, 9],
  [3, 1, 14],
  [3, 3, 26],
  [3, 3, 28],
  [3, 3, 29],
  [3, 5, 20],
  [3, 5, 22],
  [3, 5, 25],
  [3, 7, 29],
  [3, 13, 7],
  [3, 23, 25],
  [3, 25, 24],
  [3, 27, 11],
  [4, 3, 17],
  [4, 3, 27],
  [4, 5, 15],
  [5, 3, 21],
  [5, 7, 22],
  [5, 9, 7],
  [5, 9, 28],
  [5, 9, 31],
  [5, 13, 6],
  [5, 15, 17],
  [5, 17, 13],
  [5, 21, 12],
  [5, 27, 8],
  [5, 27, 21],
  [5, 27, 25],
  [5, 27, 28],
  [6, 1, 11],
  [6, 3, 17],
  [6, 17, 9],
  [6, 21, 7],
  [6, 21, 13],
  [7, 1, 9],
  [7, 1, 18],
  [7, 1, 25],
  [7, 13, 25],
  [7, 17, 21],
  [7, 25, 12],
  [7, 25, 20],
  [8, 7, 23],
  [8, 9, 23],
  [9, 5, 14],
  [9, 5, 25],
  [9, 11, 19],
  [9, 21, 16],
  [10, 9, 21],
  [10, 9, 25],
  [11, 7, 12],
  [11, 7, 16],
  [11, 17, 13],
  [11, 21, 13],
  [12, 9, 23],
  [13, 3, 17],
  [13, 3, 27],
  [13, 5, 19],
  [13, 17, 15],
  [14, 1, 15],
  [14, 13, 15],
  [15, 1, 29],
  [17, 15, 20],
  [17, 15, 23],
  [17, 15, 26],
] as const

const PUBLUS_RANDOM_FUNCTIONS = [
  (value: number, left: number, right: number, tail: number) => {
    value ^= value << left
    return (value ^= value >>> right) ^ (value << tail)
  },
  (value: number, left: number, right: number, tail: number) => {
    value ^= value << tail
    return (value ^= value >>> right) ^ (value << left)
  },
  (value: number, left: number, right: number, tail: number) => {
    value ^= value >>> left
    return (value ^= value << right) ^ (value >>> tail)
  },
  (value: number, left: number, right: number, tail: number) => {
    value ^= value >>> tail
    return (value ^= value << right) ^ (value >>> left)
  },
  (value: number, left: number, right: number, tail: number) => {
    value ^= value << left
    return (value ^= value << tail) ^ (value >>> right)
  },
  (value: number, left: number, right: number, tail: number) => {
    value ^= value >>> left
    return (value ^= value >>> tail) ^ (value << right)
  },
] as const

const PUBLUS_PARAM_COUNT = PUBLUS_RANDOM_PARAMS.length
const PUBLUS_FUNCTION_COUNT = PUBLUS_RANDOM_FUNCTIONS.length

export const PUBLUS_MODE_COUNT = PUBLUS_PARAM_COUNT * PUBLUS_FUNCTION_COUNT

class PublusRandom {
  private state = PUBLUS_RANDOM_SEED
  private params: readonly [number, number, number] = PUBLUS_RANDOM_PARAMS[74]
  private transform: (
    value: number,
    left: number,
    right: number,
    tail: number
  ) => number = PUBLUS_RANDOM_FUNCTIONS[0]

  select(paramIndex: number, functionIndex: number): void {
    this.state = PUBLUS_RANDOM_SEED
    this.params = PUBLUS_RANDOM_PARAMS[paramIndex] ?? PUBLUS_RANDOM_PARAMS[74]
    this.transform =
      PUBLUS_RANDOM_FUNCTIONS[functionIndex] ?? PUBLUS_RANDOM_FUNCTIONS[0]
  }

  seed(value: number): void {
    const normalized = value >>> 0
    this.state = normalized === 0 ? PUBLUS_RANDOM_SEED : normalized
  }

  next(limit: number): number {
    if (limit <= 1) {
      return 0
    }

    const rejectionLimit = 4294967295 - limit
    let candidate: number
    let rawMinusOne: number
    do {
      const [left, right, tail] = this.params
      this.state = this.transform(this.state, left, right, tail) >>> 0
      rawMinusOne = this.state - 1
      candidate = rawMinusOne % limit
    } while (rejectionLimit < rawMinusOne - candidate)

    return candidate
  }
}

function buildShuffleTable(
  next: (limit: number) => number,
  length: number
): number[] {
  const table: number[] = []
  for (let index = 0; index < length; index += 1) {
    const selected = next(index + 1)
    table[index] = table[selected] ?? index
    table[selected] = index
  }
  return table
}

function selectPivot(next: (limit: number) => number, length: number): number {
  return length < 4 ? next(length + 1) : next(length - 1) + 1
}

function selectExcluding(
  next: (limit: number) => number,
  excluded: number,
  length: number
): number {
  const selected = next(length)
  return selected < excluded ? selected : selected + 1
}

type PublusPartitionAxis = {
  remaining: number
  start: number
  pivot: number
  length: number
  cuts: number[]
}

function selectPartitionCut(
  next: (limit: number) => number,
  other: PublusPartitionAxis,
  edge: number,
  leading: boolean
): number {
  const containsEdge = leading
    ? (cut: number) => edge >= cut
    : (cut: number) => edge <= cut
  let start = other.start
  while (start > 0 && !containsEdge(other.cuts[start - 1])) start -= 1
  let end = other.start + other.remaining
  while (end < other.length && !containsEdge(other.cuts[end])) end += 1
  return next(end - start) + start
}

function partitionAxis(
  next: (limit: number) => number,
  axis: PublusPartitionAxis,
  other: PublusPartitionAxis,
  selected: number
): void {
  const leading = selected < axis.pivot
  const position = leading ? axis.start : axis.start + axis.remaining - 1
  const edge = leading ? axis.start : axis.start + axis.remaining
  axis.cuts[position] = selectPartitionCut(next, other, edge, leading)
  if (leading) {
    axis.start += 1
    axis.pivot -= 1
  }
  axis.remaining -= 1
}

function buildAxisPartitions(
  next: (limit: number) => number,
  horizontal: number[],
  vertical: number[],
  horizontalPivot: number,
  verticalPivot: number,
  columns: number,
  rows: number
): void {
  const columnAxis = {
    remaining: columns,
    start: 0,
    pivot: horizontalPivot,
    length: columns,
    cuts: vertical,
  }
  const rowAxis = {
    remaining: rows,
    start: 0,
    pivot: verticalPivot,
    length: rows,
    cuts: horizontal,
  }
  while (columnAxis.remaining + rowAxis.remaining > 0) {
    const selected = next(columnAxis.remaining + rowAxis.remaining)
    if (selected < columnAxis.remaining) {
      partitionAxis(next, columnAxis, rowAxis, selected)
    } else {
      partitionAxis(next, rowAxis, columnAxis, selected - columnAxis.remaining)
    }
  }
}

function buildPublusPermutationLayout(
  seed: number,
  columnSeed: number,
  rowSeed: number,
  modeSeed: number,
  grid: PublusTileGrid
) {
  const random = new PublusRandom()
  const mixedSeed = (columnSeed ^ rowSeed ^ modeSeed) >>> 0
  const seedHigh = Math.floor(seed / 65536)
  const columnHigh = Math.floor(columnSeed / 65536)
  const rowHigh = Math.floor(rowSeed / 65536)
  const modeHigh = Math.floor(modeSeed / 65536)
  const modeCount = PUBLUS_PARAM_COUNT
  const functionCount = PUBLUS_FUNCTION_COUNT
  const combinedHigh = columnHigh ^ rowHigh ^ modeHigh
  const seedMode = seedHigh ^ modeHigh
  let columnMask = seed ^ columnSeed
  let rowMask = seed ^ rowSeed
  let modeMask = seed ^ modeSeed
  const functionIndex = (combinedHigh >>> 16) % functionCount
  const paramIndex =
    Math.floor(((combinedHigh >>> 16) - functionIndex) / functionCount) %
    modeCount

  random.select(paramIndex, functionIndex)
  random.seed(mixedSeed)

  const whiteningSeed = random.next(65536) | (random.next(65536) << 16)
  // Seeds select the permutation; the admitted grid owns every allocation and loop.
  const { columns, rows } = grid

  columnMask = (columnMask ^ whiteningSeed) >>> 0
  rowMask = (rowMask ^ whiteningSeed) >>> 0
  modeMask = (modeMask ^ whiteningSeed) >>> 0

  const edgeSelector = (seedMode >>> 16) ^ random.next(512)
  const edgeFunctionIndex = edgeSelector % functionCount
  const edgeParamIndex =
    Math.floor((edgeSelector - edgeFunctionIndex) / functionCount) % modeCount

  random.select(edgeParamIndex, edgeFunctionIndex)
  const next = random.next.bind(random)

  random.seed(columnMask)
  const cellShuffle = buildShuffleTable(next, columns * rows)

  random.seed(rowMask)
  const rightPivot = selectPivot(next, columns)
  const bottomPivot = selectPivot(next, rows)
  const rightEdgeColumn = selectExcluding(next, rightPivot, columns)
  const bottomEdgeRow = selectExcluding(next, bottomPivot, rows)

  random.seed(modeMask)
  const horizontalCuts: number[] = []
  const verticalCuts: number[] = []
  buildAxisPartitions(
    next,
    horizontalCuts,
    verticalCuts,
    rightPivot,
    bottomPivot,
    columns,
    rows
  )

  const horizontalShuffle = buildShuffleTable(next, columns)
  const verticalShuffle = buildShuffleTable(next, rows)
  const rightHorizontalCuts: number[] = []
  const bottomVerticalCuts: number[] = []
  buildAxisPartitions(
    next,
    bottomVerticalCuts,
    rightHorizontalCuts,
    rightEdgeColumn,
    bottomEdgeRow,
    columns,
    rows
  )

  return {
    columns,
    rows,
    cellShuffle,
    rightPivot,
    bottomPivot,
    rightEdgeColumn,
    bottomEdgeRow,
    horizontalCuts,
    verticalCuts,
    horizontalShuffle,
    verticalShuffle,
    rightHorizontalCuts,
    bottomVerticalCuts,
  }
}

type PublusPermutationLayout = ReturnType<typeof buildPublusPermutationLayout>

function encodePartitionPosition(
  value: number,
  cut: number,
  length: number
): number {
  return value < cut ? value : value + length + 1
}

function appendPublusCellPairs(
  output: number[],
  layout: PublusPermutationLayout
): void {
  const {
    columns,
    rows,
    cellShuffle,
    horizontalCuts,
    verticalCuts,
    bottomVerticalCuts,
    rightHorizontalCuts,
  } = layout
  const encodedColumns = (columns + 1) << 1
  const encodedRows = (rows + 1) << 1
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const shuffled = cellShuffle[column + row * columns] ?? 0
      const sourceColumn = shuffled % columns
      const sourceRow = Math.floor((shuffled - sourceColumn) / columns)
      const encodedColumn = encodePartitionPosition(
        column,
        horizontalCuts[row],
        columns
      )
      const encodedRow = encodePartitionPosition(
        row,
        verticalCuts[column],
        rows
      )
      const targetColumn = encodePartitionPosition(
        sourceColumn,
        bottomVerticalCuts[sourceRow],
        columns
      )
      const targetRow = encodePartitionPosition(
        sourceRow,
        rightHorizontalCuts[sourceColumn],
        rows
      )
      output.push(targetRow * encodedColumns + encodedColumn)
      output.push(targetColumn * encodedRows + encodedRow)
    }
  }
}

type PublusEdgePermutation = {
  length: number
  shuffle: number[]
  pivot: number
  edge: number
  cuts: number[]
  oppositeCuts: number[]
  encodedAxis: number
  encodedOpposite: number
  transposed: boolean
}

function appendPublusEdgePairs(
  output: number[],
  axis: PublusEdgePermutation
): void {
  for (let index = 0; index < axis.length; index += 1) {
    const shuffled = axis.shuffle[index] ?? 0
    const encoded = encodePartitionPosition(index, axis.pivot, axis.length)
    const target = encodePartitionPosition(shuffled, axis.edge, axis.length)
    const ownCoordinate = axis.cuts[shuffled] * axis.encodedAxis + encoded
    const oppositeCoordinate =
      target * axis.encodedOpposite + axis.oppositeCuts[index]
    if (axis.transposed) output.push(oppositeCoordinate, ownCoordinate)
    else output.push(ownCoordinate, oppositeCoordinate)
  }
}

function buildPublusPermutation(
  seed: number,
  columnSeed: number,
  rowSeed: number,
  modeSeed: number,
  grid: PublusTileGrid
): number[] {
  const layout = buildPublusPermutationLayout(
    seed,
    columnSeed,
    rowSeed,
    modeSeed,
    grid
  )
  const output: number[] = []
  appendPublusCellPairs(output, layout)
  output.push(
    layout.bottomEdgeRow * ((layout.columns + 1) << 1) + layout.rightPivot
  )
  output.push(
    layout.rightEdgeColumn * ((layout.rows + 1) << 1) + layout.bottomPivot
  )
  appendPublusEdgePairs(output, {
    length: layout.columns,
    shuffle: layout.horizontalShuffle,
    pivot: layout.rightPivot,
    edge: layout.rightEdgeColumn,
    cuts: layout.rightHorizontalCuts,
    oppositeCuts: layout.verticalCuts,
    encodedAxis: (layout.columns + 1) << 1,
    encodedOpposite: (layout.rows + 1) << 1,
    transposed: false,
  })
  appendPublusEdgePairs(output, {
    length: layout.rows,
    shuffle: layout.verticalShuffle,
    pivot: layout.bottomPivot,
    edge: layout.bottomEdgeRow,
    cuts: layout.bottomVerticalCuts,
    oppositeCuts: layout.horizontalCuts,
    encodedAxis: (layout.rows + 1) << 1,
    encodedOpposite: (layout.columns + 1) << 1,
    transposed: true,
  })
  return output
}

type PublusTileDimensions = {
  tileWidth: number
  tileHeight: number
  columns: number
  rows: number
  encodedColumns: number
  encodedRows: number
  overflowWidthOffset: number
  overflowHeightOffset: number
}

function tileAxisOffset(
  index: number,
  tileSize: number,
  count: number,
  overflow: number
): number {
  return index * tileSize - (index > count ? overflow : 0)
}

function appendTileRects(
  output: PublusTileRect[],
  pairs: number[],
  start: number,
  end: number,
  width: number,
  height: number,
  dimensions: PublusTileDimensions
): void {
  if (width === 0 || height === 0) {
    return
  }

  let index = start
  while (index < end) {
    const encodedY = pairs[index++] ?? 0
    const encodedX = pairs[index++] ?? 0
    const targetColumn = encodedY % dimensions.encodedColumns
    const targetRow = encodedX % dimensions.encodedRows
    const sourceColumn = Math.floor(
      (encodedX - targetRow) / dimensions.encodedRows
    )
    const sourceRow = Math.floor(
      (encodedY - targetColumn) / dimensions.encodedColumns
    )

    output.push({
      srcX: tileAxisOffset(
        targetColumn,
        dimensions.tileWidth,
        dimensions.columns,
        dimensions.overflowWidthOffset
      ),
      srcY: tileAxisOffset(
        targetRow,
        dimensions.tileHeight,
        dimensions.rows,
        dimensions.overflowHeightOffset
      ),
      destX: tileAxisOffset(
        sourceColumn,
        dimensions.tileWidth,
        dimensions.columns,
        dimensions.overflowWidthOffset
      ),
      destY: tileAxisOffset(
        sourceRow,
        dimensions.tileHeight,
        dimensions.rows,
        dimensions.overflowHeightOffset
      ),
      width,
      height,
    })
  }
}

type PublusTileGridInput = Pick<
  PublusPageTileRectInput,
  "tileWidth" | "tileHeight" | "sourceWidth" | "sourceHeight"
>

type PublusTileGrid = { columns: number; rows: number }

// At peak, the numeric layout/pairs coexist, followed by pairs/rectangle objects.
// Include array growth and per-object overhead in a conservative working envelope.
const PUBLUS_TILE_PLAN_CELL_BYTES = 256
const PUBLUS_TILE_PLAN_FIXED_BYTES = 4 * 1024

function retainPublusTilePlan(
  grid: PublusTileGrid,
  liveResourceLedger: OffscreenLiveResourceLedger,
  retained?: OffscreenLiveResourceLease
): OffscreenLiveResourceLease {
  const bytes =
    PUBLUS_TILE_PLAN_FIXED_BYTES +
    (grid.columns + 1) * (grid.rows + 1) * PUBLUS_TILE_PLAN_CELL_BYTES
  if (retained) {
    retained.resize(bytes)
    return retained
  }
  return liveResourceLedger.reserve(
    bytes,
    "Comic Nettai tile reconstruction plan"
  )
}

function assertPublusGridWithinLimits(
  columns: number,
  rows: number,
  sourcePixels: number
): void {
  // The protocol represents each axis in 16 bits above its 32-bit seed.
  if (
    !Number.isSafeInteger(columns) ||
    !Number.isSafeInteger(rows) ||
    columns > 0xffff ||
    rows > 0xffff
  ) {
    throw new ProviderContractError(
      "Comic Nettai PUBLUS tile grid exceeds its 16-bit axis representation"
    )
  }
  if (columns * rows > Math.min(sourcePixels, MAX_DECODED_IMAGE_PIXELS)) {
    throw new ProviderContractError(
      "Comic Nettai PUBLUS tile grid exceeds its source-pixel work limit"
    )
  }
}

function readPublusTileGrid(input: PublusTileGridInput): PublusTileGrid | null {
  const { tileWidth, tileHeight, sourceWidth, sourceHeight } = input
  const columns = Math.floor(sourceWidth / tileWidth)
  const rows = Math.floor(sourceHeight / tileHeight)
  if (tileWidth <= 0 || tileHeight <= 0 || columns <= 0 || rows <= 0)
    return null
  assertPublusGridWithinLimits(columns, rows, sourceWidth * sourceHeight)
  return { columns, rows }
}

function requirePublusTileGrid(input: PublusTileGridInput): PublusTileGrid {
  const grid = readPublusTileGrid(input)
  if (!grid) {
    throw new ProviderContractError(
      "Comic Nettai PUBLUS image reconstruction produced no valid tiles"
    )
  }
  return grid
}

export function buildPublusPageTileRects(
  input: PublusPageTileRectInput
): PublusTileRect[] {
  const grid = readPublusTileGrid(input)
  if (!grid) return []
  const { columns, rows } = grid
  const { tileWidth, tileHeight, sourceWidth, sourceHeight } = input
  const remainderWidth = sourceWidth % tileWidth
  const remainderHeight = sourceHeight % tileHeight

  const encodedColumns = (columns + 1) << 1
  const encodedRows = (rows + 1) << 1
  const overflowWidthOffset = (columns + 1) * tileWidth - remainderWidth
  const overflowHeightOffset = (rows + 1) * tileHeight - remainderHeight
  const modeSelector = (input.mode ^ columns ^ rows) >>> 0
  const functionIndex = modeSelector % PUBLUS_FUNCTION_COUNT
  const paramIndex =
    Math.floor((modeSelector - functionIndex) / PUBLUS_FUNCTION_COUNT) %
    PUBLUS_PARAM_COUNT
  const random = new PublusRandom()
  random.select(paramIndex, functionIndex)
  random.seed((input.seed1 ^ input.seed2 ^ input.seed3) >>> 0)
  const permutationSeed =
    random.next(65536) +
    random.next(65536) * 65536 +
    random.next(512) * 4294967296
  const columnSeed = columns * 4294967296 + input.seed1
  const rowSeed = rows * 4294967296 + input.seed2
  const modeSeed = input.mode * 4294967296 + input.seed3
  const pairs = buildPublusPermutation(
    permutationSeed,
    columnSeed,
    rowSeed,
    modeSeed,
    grid
  )
  const rects: PublusTileRect[] = []
  const dimensions = {
    tileWidth,
    tileHeight,
    columns,
    rows,
    encodedColumns,
    encodedRows,
    overflowWidthOffset,
    overflowHeightOffset,
  }

  let start = 0
  let end = columns * rows * 2
  appendTileRects(rects, pairs, start, end, tileWidth, tileHeight, dimensions)
  start = end
  end += 2
  appendTileRects(
    rects,
    pairs,
    start,
    end,
    remainderWidth,
    remainderHeight,
    dimensions
  )
  start = end
  end += columns * 2
  appendTileRects(
    rects,
    pairs,
    start,
    end,
    tileWidth,
    remainderHeight,
    dimensions
  )
  start = end
  end += rows * 2
  appendTileRects(
    rects,
    pairs,
    start,
    end,
    remainderWidth,
    tileHeight,
    dimensions
  )

  return rects
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  const base64 =
    typeof btoa === "function"
      ? btoa(binary)
      : (
          globalThis as unknown as {
            Buffer: {
              from(value: Uint8Array): { toString(encoding: string): string }
            }
          }
        ).Buffer.from(bytes).toString("base64")
  return base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=")
  const binary =
    typeof atob === "function"
      ? atob(base64)
      : (
          globalThis as unknown as {
            Buffer: {
              from(
                value: string,
                encoding: string
              ): { toString(encoding?: string): string }
            }
          }
        ).Buffer.from(base64, "base64").toString()
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function isPublusImageMetadata(value: unknown): value is PublusImageMetadata {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    ["mode", "seed1", "seed2", "seed3"].every(
      (key) =>
        typeof candidate[key] === "number" &&
        Number.isFinite(candidate[key]) &&
        candidate[key] >= 0
    ) &&
    ["tileWidth", "tileHeight"].every(
      (key) =>
        typeof candidate[key] === "number" &&
        Number.isFinite(candidate[key]) &&
        candidate[key] > 0
    )
  )
}

export function appendPublusImageMetadata(
  imageUrl: string,
  metadata: PublusImageMetadata
): string {
  const url = new URL(imageUrl)
  const payload = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(metadata))
  )
  const fragment = new URLSearchParams(
    url.hash.startsWith("#") ? url.hash.slice(1) : url.hash
  )
  fragment.set(PUBLUS_METADATA_FRAGMENT_KEY, payload)
  url.hash = fragment.toString()
  return url.toString()
}

export function parsePublusImageTransportUrl(imageUrl: string): {
  sourceUrl: string
  metadata: PublusImageMetadata | null
} {
  const url = new URL(imageUrl)
  const fragment = new URLSearchParams(
    url.hash.startsWith("#") ? url.hash.slice(1) : url.hash
  )
  const encodedMetadata = fragment.get(PUBLUS_METADATA_FRAGMENT_KEY)
  url.hash = ""
  if (!encodedMetadata) {
    return { sourceUrl: url.toString(), metadata: null }
  }

  const decoded = JSON.parse(
    new TextDecoder().decode(base64UrlToBytes(encodedMetadata))
  ) as unknown
  return {
    sourceUrl: url.toString(),
    metadata: isPublusImageMetadata(decoded) ? decoded : null,
  }
}

function assertPublusRendererAvailable(): void {
  if (!isImageBitmapRenderingAvailable()) {
    throw new ProviderContractError(
      "Comic Nettai PUBLUS image reconstruction is unavailable in this browser context"
    )
  }
}

function drawPublusImage(
  bitmap: ImageBitmap,
  metadata: PublusImageMetadata
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext("2d")
  if (!context) {
    throw new ProviderContractError(
      "Comic Nettai PUBLUS image reconstruction could not create a canvas context"
    )
  }
  context.imageSmoothingEnabled = false
  const rects = buildPublusPageTileRects({
    ...metadata,
    sourceWidth: bitmap.width,
    sourceHeight: bitmap.height,
  })
  if (rects.length === 0) {
    throw new ProviderContractError(
      "Comic Nettai PUBLUS image reconstruction produced no valid tiles"
    )
  }
  for (const rect of rects) {
    // The viewer's rect names are source-oriented: destX/destY point into the shuffled bitmap,
    // while srcX/srcY are the ordered canvas coordinates.
    context.drawImage(
      bitmap,
      rect.destX,
      rect.destY,
      rect.width,
      rect.height,
      rect.srcX,
      rect.srcY,
      rect.width,
      rect.height
    )
  }
  return canvas
}

type PublusReconstructedImage = {
  data: ArrayBuffer
  mimeType: string
  liveResourceLease: OffscreenLiveResourceLease
}

async function encodePublusImage(
  canvas: OffscreenCanvas,
  dimensions: { width: number; height: number },
  mimeType: string,
  liveResourceLedger: OffscreenLiveResourceLedger
): Promise<PublusReconstructedImage> {
  const outputMimeType = mimeType.startsWith("image/") ? mimeType : "image/png"
  let outputBlobLease: OffscreenLiveResourceLease | undefined =
    liveResourceLedger.reserve(
      Math.max(MAX_IMAGE_BYTES, dimensions.width * dimensions.height * 4),
      "Comic Nettai encoded output Blob"
    )
  let outputBufferLease: OffscreenLiveResourceLease | undefined
  try {
    const outputBlob = await canvas.convertToBlob({
      type: outputMimeType,
      quality: outputMimeType === "image/jpeg" ? 0.92 : undefined,
    })
    if (outputBlob.size > MAX_IMAGE_BYTES) {
      throw new ProviderContractError(
        `Comic Nettai encoded output exceeds ${MAX_IMAGE_BYTES} byte limit (got ${outputBlob.size})`
      )
    }
    outputBlobLease.resize(outputBlob.size)
    outputBufferLease = liveResourceLedger.reserve(
      outputBlob.size,
      "Comic Nettai encoded output ArrayBuffer"
    )
    const data = await outputBlob.arrayBuffer()
    outputBlobLease.release()
    outputBlobLease = undefined
    const liveResourceLease = outputBufferLease.transfer(
      "retained Comic Nettai encoded output"
    )
    outputBufferLease = undefined
    return {
      data,
      mimeType: outputBlob.type || outputMimeType,
      liveResourceLease,
    }
  } finally {
    outputBlobLease?.release()
    outputBufferLease?.release()
  }
}

async function reconstructPublusImage(
  buffer: ArrayBuffer,
  mimeType: string,
  metadata: PublusImageMetadata,
  dimensions: { width: number; height: number },
  liveResourceLedger: OffscreenLiveResourceLedger
): Promise<PublusReconstructedImage> {
  const encodedGrid = readPublusTileGrid({
    ...metadata,
    sourceWidth: dimensions.width,
    sourceHeight: dimensions.height,
  })
  let tilePlanLease = encodedGrid
    ? retainPublusTilePlan(encodedGrid, liveResourceLedger)
    : undefined
  let decodedSurfaceLease: OffscreenLiveResourceLease | undefined
  let sourceBlobLease: OffscreenLiveResourceLease | undefined
  try {
    decodedSurfaceLease = liveResourceLedger.reserve(
      dimensions.width * dimensions.height * 8,
      "Comic Nettai decoded source and destination surfaces"
    )
    sourceBlobLease = liveResourceLedger.reserve(
      buffer.byteLength,
      "Comic Nettai encoded source Blob"
    )
    const bitmap = await createImageBitmap(
      new Blob([buffer], { type: mimeType })
    )
    sourceBlobLease.release()
    sourceBlobLease = undefined
    try {
      assertDecodedImageWithinLimits(
        bitmap.width,
        bitmap.height,
        "Comic Nettai"
      )
      const bitmapGrid = requirePublusTileGrid({
        ...metadata,
        sourceWidth: bitmap.width,
        sourceHeight: bitmap.height,
      })
      tilePlanLease = retainPublusTilePlan(
        bitmapGrid,
        liveResourceLedger,
        tilePlanLease
      )
      const canvas = drawPublusImage(bitmap, metadata)
      tilePlanLease.release()
      tilePlanLease = undefined
      return await encodePublusImage(
        canvas,
        bitmap,
        mimeType,
        liveResourceLedger
      )
    } finally {
      bitmap.close()
    }
  } finally {
    sourceBlobLease?.release()
    decodedSurfaceLease?.release()
    tilePlanLease?.release()
  }
}

export async function descramblePublusImage(
  buffer: ArrayBuffer,
  mimeType: string,
  metadata: PublusImageMetadata,
  signal: AbortSignal | undefined,
  liveResourceLedger: OffscreenLiveResourceLedger,
  sourceLease: OffscreenLiveResourceLease
): Promise<PublusReconstructedImage> {
  try {
    assertPublusRendererAvailable()
    const dimensions = readEncodedImageDimensions(
      buffer,
      mimeType,
      liveResourceLedger
    )
    assertDecodedImageWithinLimits(
      dimensions.width,
      dimensions.height,
      "Comic Nettai"
    )
    return await withRendererPixelBudget(
      dimensions.width * dimensions.height,
      signal,
      () =>
        reconstructPublusImage(
          buffer,
          mimeType,
          metadata,
          dimensions,
          liveResourceLedger
        )
    )
  } finally {
    sourceLease.release()
  }
}
