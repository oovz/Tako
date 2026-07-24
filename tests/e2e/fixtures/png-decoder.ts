import { inflateSync } from "node:zlib"
import { Buffer } from "node:buffer"

interface DecodedRgbaPng {
  width: number
  height: number
  pixels: Uint8Array
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  ).getUint32(offset, false)
}

function paethPredictor(
  left: number,
  above: number,
  upperLeft: number
): number {
  const estimate = left + above - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const aboveDistance = Math.abs(estimate - above)
  const upperLeftDistance = Math.abs(estimate - upperLeft)

  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft
}

/**
 * Decode the non-interlaced RGB/RGBA PNG output produced by the test archive
 * workflow. Keeping this small decoder in test code avoids adding an image
 * parser to the extension solely for output assertions.
 */
export function decodeRgbaPng(bytes: Uint8Array): DecodedRgbaPng {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!signature.every((value, index) => bytes[index] === value)) {
    throw new Error("Expected a PNG signature in the archive output")
  }

  let offset = signature.length
  let width = 0
  let height = 0
  let colorType = -1
  let bitDepth = -1
  let interlaceMethod = -1
  const idatChunks: Uint8Array[] = []

  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + length
    if (chunkEnd + 4 > bytes.length) {
      throw new Error("PNG chunk exceeds the archive image boundary")
    }

    const chunk = bytes.subarray(chunkStart, chunkEnd)
    if (type === "IHDR") {
      width = readUint32(chunk, 0)
      height = readUint32(chunk, 4)
      bitDepth = chunk[8] ?? -1
      colorType = chunk[9] ?? -1
      interlaceMethod = chunk[12] ?? -1
    } else if (type === "IDAT") {
      idatChunks.push(chunk)
    } else if (type === "IEND") {
      break
    }
    offset = chunkEnd + 4
  }

  if (
    width <= 0 ||
    height <= 0 ||
    bitDepth !== 8 ||
    (colorType !== 2 && colorType !== 6) ||
    interlaceMethod !== 0 ||
    idatChunks.length === 0
  ) {
    throw new Error(
      `Unsupported PNG output: ${JSON.stringify({
        width,
        height,
        bitDepth,
        colorType,
        interlaceMethod,
      })}`
    )
  }

  const sourceChannels = colorType === 6 ? 4 : 3
  const rowBytes = width * sourceChannels
  const inflated = inflateSync(Buffer.concat(idatChunks))
  const expectedInflatedLength = height * (rowBytes + 1)
  if (inflated.length !== expectedInflatedLength) {
    throw new Error(
      `Unexpected PNG scanline length: expected ${expectedInflatedLength}, received ${inflated.length}`
    )
  }

  const sourcePixels = new Uint8Array(width * height * sourceChannels)
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * (rowBytes + 1)
    const targetOffset = row * rowBytes
    const filter = inflated[sourceOffset] ?? -1

    for (let column = 0; column < rowBytes; column += 1) {
      const raw = inflated[sourceOffset + 1 + column] ?? 0
      const left =
        column >= sourceChannels
          ? (sourcePixels[targetOffset + column - sourceChannels] ?? 0)
          : 0
      const above =
        row > 0 ? (sourcePixels[targetOffset - rowBytes + column] ?? 0) : 0
      const upperLeft =
        row > 0 && column >= sourceChannels
          ? (sourcePixels[targetOffset - rowBytes + column - sourceChannels] ??
            0)
          : 0

      const reconstructed =
        filter === 0
          ? raw
          : filter === 1
            ? (raw + left) & 0xff
            : filter === 2
              ? (raw + above) & 0xff
              : filter === 3
                ? (raw + Math.floor((left + above) / 2)) & 0xff
                : filter === 4
                  ? (raw + paethPredictor(left, above, upperLeft)) & 0xff
                  : Number.NaN
      if (!Number.isFinite(reconstructed)) {
        throw new Error(`Unsupported PNG scanline filter ${filter}`)
      }
      sourcePixels[targetOffset + column] = reconstructed
    }
  }

  const pixels = new Uint8Array(width * height * 4)
  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const sourceOffset = pixelIndex * sourceChannels
    const targetOffset = pixelIndex * 4
    pixels[targetOffset] = sourcePixels[sourceOffset] ?? 0
    pixels[targetOffset + 1] = sourcePixels[sourceOffset + 1] ?? 0
    pixels[targetOffset + 2] = sourcePixels[sourceOffset + 2] ?? 0
    pixels[targetOffset + 3] =
      colorType === 6 ? (sourcePixels[sourceOffset + 3] ?? 0) : 255
  }

  return { width, height, pixels }
}
