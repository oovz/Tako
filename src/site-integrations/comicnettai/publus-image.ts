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

const PUBLUS_METADATA_FRAGMENT_KEY = 'tmdPublus'
const PUBLUS_RANDOM_SEED = 2463534242
// Ported from the official PUBLUS NFBR.b9n.a3f helper used by Comic Nettai's viewer.
const PUBLUS_RANDOM_PARAMS = [
  [1, 3, 10], [1, 5, 16], [1, 5, 19], [1, 9, 29], [1, 11, 6], [1, 11, 16],
  [1, 19, 3], [1, 21, 20], [1, 27, 27], [2, 5, 15], [2, 5, 21], [2, 7, 7],
  [2, 7, 9], [2, 7, 25], [2, 9, 15], [2, 15, 17], [2, 15, 25], [2, 21, 9],
  [3, 1, 14], [3, 3, 26], [3, 3, 28], [3, 3, 29], [3, 5, 20], [3, 5, 22],
  [3, 5, 25], [3, 7, 29], [3, 13, 7], [3, 23, 25], [3, 25, 24], [3, 27, 11],
  [4, 3, 17], [4, 3, 27], [4, 5, 15], [5, 3, 21], [5, 7, 22], [5, 9, 7],
  [5, 9, 28], [5, 9, 31], [5, 13, 6], [5, 15, 17], [5, 17, 13], [5, 21, 12],
  [5, 27, 8], [5, 27, 21], [5, 27, 25], [5, 27, 28], [6, 1, 11], [6, 3, 17],
  [6, 17, 9], [6, 21, 7], [6, 21, 13], [7, 1, 9], [7, 1, 18], [7, 1, 25],
  [7, 13, 25], [7, 17, 21], [7, 25, 12], [7, 25, 20], [8, 7, 23], [8, 9, 23],
  [9, 5, 14], [9, 5, 25], [9, 11, 19], [9, 21, 16], [10, 9, 21], [10, 9, 25],
  [11, 7, 12], [11, 7, 16], [11, 17, 13], [11, 21, 13], [12, 9, 23], [13, 3, 17],
  [13, 3, 27], [13, 5, 19], [13, 17, 15], [14, 1, 15], [14, 13, 15],
  [15, 1, 29], [17, 15, 20], [17, 15, 23], [17, 15, 26],
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
  private transform: (value: number, left: number, right: number, tail: number) => number = PUBLUS_RANDOM_FUNCTIONS[0]

  select(paramIndex: number, functionIndex: number): void {
    this.state = PUBLUS_RANDOM_SEED
    this.params = PUBLUS_RANDOM_PARAMS[paramIndex] ?? PUBLUS_RANDOM_PARAMS[74]
    this.transform = PUBLUS_RANDOM_FUNCTIONS[functionIndex] ?? PUBLUS_RANDOM_FUNCTIONS[0]
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

function buildShuffleTable(next: (limit: number) => number, length: number): number[] {
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

function selectExcluding(next: (limit: number) => number, excluded: number, length: number): number {
  if (length <= 0) {
    return 0
  }

  const selected = next(length)
  return selected < excluded ? selected : selected + 1
}

function buildAxisPartitions(
  next: (limit: number) => number,
  horizontal: number[],
  vertical: number[],
  horizontalPivot: number,
  verticalPivot: number,
  columns: number,
  rows: number,
): void {
  let remainingColumns = columns
  let remainingRows = rows
  let leftColumn = 0
  let topRow = 0

  while (remainingColumns + remainingRows > 0) {
    const selected = next(remainingColumns + remainingRows)
    if (selected < remainingColumns) {
      if (selected < horizontalPivot) {
        let start = topRow
        for (; start > 0 && !(leftColumn >= horizontal[start - 1]); start -= 1);
        let end = topRow + remainingRows
        for (; end < rows && !(leftColumn >= horizontal[end]); end += 1);
        vertical[leftColumn] = next(end - start) + start
        leftColumn += 1
        horizontalPivot -= 1
      } else {
        let start = topRow
        for (; start > 0 && !(leftColumn + remainingColumns <= horizontal[start - 1]); start -= 1);
        let end = topRow + remainingRows
        for (; end < rows && !(leftColumn + remainingColumns <= horizontal[end]); end += 1);
        vertical[leftColumn + remainingColumns - 1] = next(end - start) + start
      }
      remainingColumns -= 1
    } else {
      if (selected - remainingColumns < verticalPivot) {
        let start = leftColumn
        for (; start > 0 && !(topRow >= vertical[start - 1]); start -= 1);
        let end = leftColumn + remainingColumns
        for (; end < columns && !(topRow >= vertical[end]); end += 1);
        horizontal[topRow] = next(end - start) + start
        topRow += 1
        verticalPivot -= 1
      } else {
        let start = leftColumn
        for (; start > 0 && !(topRow + remainingRows <= vertical[start - 1]); start -= 1);
        let end = leftColumn + remainingColumns
        for (; end < columns && !(topRow + remainingRows <= vertical[end]); end += 1);
        horizontal[topRow + remainingRows - 1] = next(end - start) + start
      }
      remainingRows -= 1
    }
  }
}

function buildPublusPermutation(seed: number, columnSeed: number, rowSeed: number, modeSeed: number): number[] {
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
  const paramIndex = Math.floor(((combinedHigh >>> 16) - functionIndex) / functionCount) % modeCount

  random.select(paramIndex, functionIndex)
  random.seed(mixedSeed)

  const whiteningSeed = random.next(65536) | (random.next(65536) << 16)
  const columns = columnHigh >>> 16
  const rows = rowHigh >>> 16

  columnMask = (columnMask ^ whiteningSeed) >>> 0
  rowMask = (rowMask ^ whiteningSeed) >>> 0
  modeMask = (modeMask ^ whiteningSeed) >>> 0

  const edgeSelector = (seedMode >>> 16) ^ random.next(512)
  const edgeFunctionIndex = edgeSelector % functionCount
  const edgeParamIndex = Math.floor((edgeSelector - edgeFunctionIndex) / functionCount) % modeCount

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
  buildAxisPartitions(next, horizontalCuts, verticalCuts, rightPivot, bottomPivot, columns, rows)

  const horizontalShuffle = buildShuffleTable(next, columns)
  const verticalShuffle = buildShuffleTable(next, rows)
  const rightHorizontalCuts: number[] = []
  const bottomVerticalCuts: number[] = []
  buildAxisPartitions(next, bottomVerticalCuts, rightHorizontalCuts, rightEdgeColumn, bottomEdgeRow, columns, rows)

  const output: number[] = []
  const columnWrap = columns + 1
  const rowWrap = rows + 1
  const encodedColumns = columnWrap << 1
  const encodedRows = rowWrap << 1

  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const shuffled = cellShuffle[column + row * columns] ?? 0
      const sourceColumn = shuffled % columns
      const sourceRow = Math.floor((shuffled - sourceColumn) / columns)
      const encodedColumn = column < horizontalCuts[row] ? column : column + columnWrap
      const encodedRow = row < verticalCuts[column] ? row : row + rowWrap
      const targetColumn = sourceColumn < bottomVerticalCuts[sourceRow] ? sourceColumn : sourceColumn + columnWrap
      const targetRow = sourceRow < rightHorizontalCuts[sourceColumn] ? sourceRow : sourceRow + rowWrap
      output.push(targetRow * encodedColumns + encodedColumn)
      output.push(targetColumn * encodedRows + encodedRow)
    }
  }

  output.push(bottomEdgeRow * encodedColumns + rightPivot)
  output.push(rightEdgeColumn * encodedRows + bottomPivot)

  for (let column = 0; column < columns; column += 1) {
    const shuffledColumn = horizontalShuffle[column] ?? 0
    const encodedColumn = column < rightPivot ? column : column + columnWrap
    const targetColumn = shuffledColumn < rightEdgeColumn ? shuffledColumn : shuffledColumn + columnWrap
    output.push(rightHorizontalCuts[shuffledColumn] * encodedColumns + encodedColumn)
    output.push(targetColumn * encodedRows + verticalCuts[column])
  }

  for (let row = 0; row < rows; row += 1) {
    const shuffledRow = verticalShuffle[row] ?? 0
    const encodedRow = row < bottomPivot ? row : row + rowWrap
    const targetRow = shuffledRow < bottomEdgeRow ? shuffledRow : shuffledRow + rowWrap
    output.push(targetRow * encodedColumns + horizontalCuts[row])
    output.push(bottomVerticalCuts[shuffledRow] * encodedRows + encodedRow)
  }

  return output
}

function appendTileRects(
  output: PublusTileRect[],
  pairs: number[],
  start: number,
  end: number,
  width: number,
  height: number,
  dimensions: {
    tileWidth: number
    tileHeight: number
    columns: number
    rows: number
    encodedColumns: number
    encodedRows: number
    overflowWidthOffset: number
    overflowHeightOffset: number
  },
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
    const sourceColumn = Math.floor((encodedX - targetRow) / dimensions.encodedRows)
    const sourceRow = Math.floor((encodedY - targetColumn) / dimensions.encodedColumns)

    output.push({
      srcX: targetColumn * dimensions.tileWidth - (targetColumn > dimensions.columns ? dimensions.overflowWidthOffset : 0),
      srcY: targetRow * dimensions.tileHeight - (targetRow > dimensions.rows ? dimensions.overflowHeightOffset : 0),
      destX: sourceColumn * dimensions.tileWidth - (sourceColumn > dimensions.columns ? dimensions.overflowWidthOffset : 0),
      destY: sourceRow * dimensions.tileHeight - (sourceRow > dimensions.rows ? dimensions.overflowHeightOffset : 0),
      width,
      height,
    })
  }
}

export function buildPublusPageTileRects(input: PublusPageTileRectInput): PublusTileRect[] {
  const { tileWidth, tileHeight, sourceWidth, sourceHeight } = input
  const columns = Math.floor(sourceWidth / tileWidth)
  const rows = Math.floor(sourceHeight / tileHeight)
  const remainderWidth = sourceWidth % tileWidth
  const remainderHeight = sourceHeight % tileHeight
  if (tileWidth <= 0 || tileHeight <= 0 || columns <= 0 || rows <= 0) {
    return []
  }

  const encodedColumns = (columns + 1) << 1
  const encodedRows = (rows + 1) << 1
  const overflowWidthOffset = (columns + 1) * tileWidth - remainderWidth
  const overflowHeightOffset = (rows + 1) * tileHeight - remainderHeight
  const modeSelector = (input.mode ^ columns ^ rows) >>> 0
  const functionIndex = modeSelector % PUBLUS_FUNCTION_COUNT
  const paramIndex = Math.floor((modeSelector - functionIndex) / PUBLUS_FUNCTION_COUNT) % PUBLUS_PARAM_COUNT
  const random = new PublusRandom()
  random.select(paramIndex, functionIndex)
  random.seed((input.seed1 ^ input.seed2 ^ input.seed3) >>> 0)
  const permutationSeed = random.next(65536) + (random.next(65536) * 65536) + (random.next(512) * 4294967296)
  const columnSeed = (columns * 4294967296) + input.seed1
  const rowSeed = (rows * 4294967296) + input.seed2
  const modeSeed = (input.mode * 4294967296) + input.seed3
  const pairs = buildPublusPermutation(permutationSeed, columnSeed, rowSeed, modeSeed)
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
  appendTileRects(rects, pairs, start, end, remainderWidth, remainderHeight, dimensions)
  start = end
  end += columns * 2
  appendTileRects(rects, pairs, start, end, tileWidth, remainderHeight, dimensions)
  start = end
  end += rows * 2
  appendTileRects(rects, pairs, start, end, remainderWidth, tileHeight, dimensions)

  return rects
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : (globalThis as unknown as { Buffer: { from(value: Uint8Array): { toString(encoding: string): string } } }).Buffer.from(bytes).toString('base64')
  return base64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = typeof atob === 'function'
    ? atob(base64)
    : (globalThis as unknown as { Buffer: { from(value: string, encoding: string): { toString(encoding?: string): string } } }).Buffer.from(base64, 'base64').toString()
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function isPublusImageMetadata(value: unknown): value is PublusImageMetadata {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return ['mode', 'seed1', 'seed2', 'seed3'].every((key) => (
    typeof candidate[key] === 'number'
    && Number.isFinite(candidate[key])
    && candidate[key] >= 0
  ))
    && ['tileWidth', 'tileHeight'].every((key) => (
      typeof candidate[key] === 'number'
      && Number.isFinite(candidate[key])
      && candidate[key] > 0
    ))
}

export function appendPublusImageMetadata(imageUrl: string, metadata: PublusImageMetadata): string {
  const url = new URL(imageUrl)
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(metadata)))
  const fragment = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
  fragment.set(PUBLUS_METADATA_FRAGMENT_KEY, payload)
  url.hash = fragment.toString()
  return url.toString()
}

export function parsePublusImageTransportUrl(imageUrl: string): { sourceUrl: string; metadata: PublusImageMetadata | null } {
  const url = new URL(imageUrl)
  const fragment = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
  const encodedMetadata = fragment.get(PUBLUS_METADATA_FRAGMENT_KEY)
  url.hash = ''
  if (!encodedMetadata) {
    return { sourceUrl: url.toString(), metadata: null }
  }

  const decoded = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encodedMetadata))) as unknown
  return {
    sourceUrl: url.toString(),
    metadata: isPublusImageMetadata(decoded) ? decoded : null,
  }
}

export async function descramblePublusImage(
  buffer: ArrayBuffer,
  mimeType: string,
  metadata: PublusImageMetadata,
): Promise<ArrayBuffer> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    return buffer
  }

  const blob = new Blob([buffer], { type: mimeType })
  const bitmap = await createImageBitmap(blob)

  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    if (!context) {
      return buffer
    }

    context.imageSmoothingEnabled = false
    const rects = buildPublusPageTileRects({
      ...metadata,
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
    })
    if (rects.length === 0) {
      return buffer
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
        rect.height,
      )
    }

    const outputMimeType = mimeType.startsWith('image/') ? mimeType : 'image/png'
    const outputBlob = await canvas.convertToBlob({
      type: outputMimeType,
      quality: outputMimeType === 'image/jpeg' ? 0.92 : undefined,
    })
    return await outputBlob.arrayBuffer()
  } finally {
    bitmap.close()
  }
}
