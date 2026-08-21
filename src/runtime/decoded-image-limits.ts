import {
  MAX_DECODED_IMAGE_PIXELS,
  MAX_IMAGE_DIMENSION_PX,
} from "@/src/constants/timeouts"
import { NonRetryableDownloadError } from "@/src/shared/download-contract"

export class DecodedImageResourceLimitError extends NonRetryableDownloadError {
  constructor(message: string) {
    super(message)
    this.name = "DecodedImageResourceLimitError"
  }
}

export type EncodedImageDimensions = {
  width: number
  height: number
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  )
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] +
    (bytes[offset + 1] << 8) +
    (bytes[offset + 2] << 16) +
    bytes[offset + 3] * 0x1000000
  )
}

function hasBytes(bytes: Uint8Array, offset: number, length: number): boolean {
  return offset >= 0 && length >= 0 && offset + length <= bytes.length
}

function readPngDimensions(bytes: Uint8Array): EncodedImageDimensions | null {
  if (
    !hasBytes(bytes, 0, 24) ||
    !bytes
      .subarray(0, 8)
      .every(
        (value, index) =>
          value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]
      ) ||
    String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR"
  ) {
    return null
  }
  return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) }
}

function readGifDimensions(bytes: Uint8Array): EncodedImageDimensions | null {
  if (
    !hasBytes(bytes, 0, 10) ||
    (String.fromCharCode(...bytes.subarray(0, 6)) !== "GIF89a" &&
      String.fromCharCode(...bytes.subarray(0, 6)) !== "GIF87a")
  ) {
    return null
  }
  return { width: readUint16LE(bytes, 6), height: readUint16LE(bytes, 8) }
}

const MAX_JPEG_METADATA_BYTES = 1024 * 1024

function readJpegDimensions(bytes: Uint8Array): EncodedImageDimensions | null {
  if (!hasBytes(bytes, 0, 2) || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null
  }
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ])
  let offset = 2
  while (hasBytes(bytes, offset, 1)) {
    if (offset - 2 >= MAX_JPEG_METADATA_BYTES || bytes[offset] !== 0xff) {
      return null
    }
    while (
      hasBytes(bytes, offset, 1) &&
      bytes[offset] === 0xff &&
      offset - 2 < MAX_JPEG_METADATA_BYTES
    ) {
      offset += 1
    }
    if (!hasBytes(bytes, offset, 1)) return null
    const marker = bytes[offset++]
    if (marker === 0xda || marker === 0xd9) return null
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue
    }
    if (!hasBytes(bytes, offset, 2)) return null
    const segmentLength = readUint16BE(bytes, offset)
    if (segmentLength < 2 || !hasBytes(bytes, offset, segmentLength)) {
      return null
    }
    if (offset + segmentLength - 2 > MAX_JPEG_METADATA_BYTES) {
      return null
    }
    if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
      return {
        width: readUint16BE(bytes, offset + 5),
        height: readUint16BE(bytes, offset + 3),
      }
    }
    offset += segmentLength
  }
  return null
}

function readWebpDimensions(bytes: Uint8Array): EncodedImageDimensions | null {
  if (
    !hasBytes(bytes, 0, 16) ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" ||
    String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP"
  ) {
    return null
  }
  const maxMetadataOffset = Math.min(bytes.byteLength, 1024 * 1024)
  const maxChunks = 4096
  let chunksScanned = 0
  let offset = 12
  while (
    offset < maxMetadataOffset &&
    chunksScanned < maxChunks &&
    hasBytes(bytes, offset, 8)
  ) {
    chunksScanned += 1
    const type = String.fromCharCode(...bytes.subarray(offset, offset + 4))
    const size = readUint32LE(bytes, offset + 4)
    const payload = offset + 8
    if (!hasBytes(bytes, payload, size)) return null
    if (type === "VP8X" && size >= 10) {
      return {
        width:
          1 +
          bytes[payload + 4] +
          (bytes[payload + 5] << 8) +
          (bytes[payload + 6] << 16),
        height:
          1 +
          bytes[payload + 7] +
          (bytes[payload + 8] << 8) +
          (bytes[payload + 9] << 16),
      }
    }
    if (type === "VP8L" && size >= 5 && bytes[payload] === 0x2f) {
      const bits = readUint32LE(bytes, payload + 1)
      return {
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >>> 14) & 0x3fff),
      }
    }
    if (type === "VP8 " && size >= 10) {
      if (
        bytes[payload + 3] === 0x9d &&
        bytes[payload + 4] === 0x01 &&
        bytes[payload + 5] === 0x2a
      ) {
        return {
          width: readUint16LE(bytes, payload + 6) & 0x3fff,
          height: readUint16LE(bytes, payload + 8) & 0x3fff,
        }
      }
    }
    if (payload + size > maxMetadataOffset) return null
    offset = payload + size + (size % 2)
  }
  return null
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

export function readEncodedImageDimensions(
  buffer: ArrayBuffer,
  mimeType: string
): EncodedImageDimensions {
  if (mimeType === "image/avif") {
    throw new DecodedImageResourceLimitError(
      "AVIF images are not supported by the bounded dimension preflight"
    )
  }
  const bytes = new Uint8Array(buffer)
  const dimensions =
    readPngDimensions(bytes) ??
    readJpegDimensions(bytes) ??
    readWebpDimensions(bytes) ??
    readGifDimensions(bytes)
  if (!dimensions) {
    throw new DecodedImageResourceLimitError(
      `Encoded ${mimeType} image dimensions are unavailable`
    )
  }
  return dimensions
}

export function assertDecodedImageWithinLimits(
  width: number,
  height: number,
  providerLabel: string
): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new DecodedImageResourceLimitError(
      `${providerLabel} decoded image has invalid dimensions: ${width}x${height}`
    )
  }

  if (width > MAX_IMAGE_DIMENSION_PX || height > MAX_IMAGE_DIMENSION_PX) {
    throw new DecodedImageResourceLimitError(
      `${providerLabel} decoded image exceeds the ${MAX_IMAGE_DIMENSION_PX}px dimension limit: ${width}x${height}`
    )
  }

  const pixels = width * height
  if (pixels > MAX_DECODED_IMAGE_PIXELS) {
    throw new DecodedImageResourceLimitError(
      `${providerLabel} decoded image exceeds the ${MAX_DECODED_IMAGE_PIXELS} pixel limit: ${width}x${height}`
    )
  }
}
