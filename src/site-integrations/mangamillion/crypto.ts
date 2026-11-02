import { MAX_IMAGE_BYTES } from "@/src/constants/timeouts"
import type {
  OffscreenLiveResourceLedger,
  OffscreenLiveResourceLease,
} from "@/src/runtime/offscreen-live-resource-ledger"
import { ProviderContractError } from "@/src/site-integrations/provider-contract-error"

const AVIF_BRANDS = new Set(["avif", "avis", "avio"])

function hasAvifFileTypeBrand(data: Uint8Array): boolean {
  if (
    data.length < 12 ||
    String.fromCharCode(data[4], data[5], data[6], data[7]) !== "ftyp"
  ) {
    return false
  }
  if (data.length < 16) return false
  const size = data[0] * 0x1000000 + (data[1] << 16) + (data[2] << 8) + data[3]
  if (size < 16 || size > data.length) return false
  for (let offset = 8; offset + 4 <= size; offset += 4) {
    if (
      AVIF_BRANDS.has(
        String.fromCharCode(
          data[offset],
          data[offset + 1],
          data[offset + 2],
          data[offset + 3]
        )
      )
    ) {
      return true
    }
  }
  return false
}

export function hexToBytes(hex: string): Uint8Array {
  const matches = hex.match(/.{1,2}/g)
  if (!matches) {
    return new Uint8Array(0)
  }
  const result = new Uint8Array(matches.length)
  for (let i = 0; i < matches.length; i++) {
    result[i] = Number.parseInt(matches[i], 16)
  }
  return result
}

type ImageFormat = { mimeType: string; extension: string }
const IMAGE_SIGNATURES = [
  {
    bytes: [0x52, 0x49, 0x46, 0x46],
    offset: 0,
    tail: [0x57, 0x45, 0x42, 0x50],
    tailOffset: 8,
    mimeType: "image/webp",
    extension: ".webp",
  },
  {
    bytes: [0xff, 0xd8, 0xff],
    offset: 0,
    mimeType: "image/jpeg",
    extension: ".jpg",
  },
  {
    bytes: [0x89, 0x50, 0x4e, 0x47],
    offset: 0,
    mimeType: "image/png",
    extension: ".png",
  },
  {
    bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
    offset: 0,
    mimeType: "image/gif",
    extension: ".gif",
  },
  {
    bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
    offset: 0,
    mimeType: "image/gif",
    extension: ".gif",
  },
]

function matchesImageSignature(
  data: Uint8Array,
  bytes: number[],
  offset: number
): boolean {
  return bytes.every((byte, index) => data[offset + index] === byte)
}

export function detectImageMimeTypeAndExt(data: Uint8Array): ImageFormat {
  const format = IMAGE_SIGNATURES.find(
    (signature) =>
      matchesImageSignature(data, signature.bytes, signature.offset) &&
      (!signature.tail ||
        matchesImageSignature(data, signature.tail, signature.tailOffset))
  )
  if (format?.mimeType === "image/webp")
    return { mimeType: format.mimeType, extension: format.extension }
  if (hasAvifFileTypeBrand(data))
    return { mimeType: "image/avif", extension: ".avif" }
  if (format) return { mimeType: format.mimeType, extension: format.extension }
  throw new ProviderContractError(
    "MangaMillion image bytes do not have a supported image signature"
  )
}

export async function decryptPageImage(
  encryptedData: ArrayBuffer,
  hexKey: string,
  hexIv: string,
  liveResourceLedger: OffscreenLiveResourceLedger,
  sourceLease: OffscreenLiveResourceLease
): Promise<{
  data: ArrayBuffer
  mimeType: string
  extension: string
  liveResourceLease: OffscreenLiveResourceLease
}> {
  let inputCopyLease: OffscreenLiveResourceLease | undefined
  let decryptedLease: OffscreenLiveResourceLease | undefined
  try {
    const keyBytes = hexToBytes(hexKey)
    const ivBytes = hexToBytes(hexIv)

    if (keyBytes.length !== 32 || ivBytes.length !== 16) {
      throw new Error(
        `Invalid AES key/IV lengths: key ${keyBytes.length} bytes (expected 32), iv ${ivBytes.length} bytes (expected 16)`
      )
    }

    inputCopyLease = liveResourceLedger.reserve(
      encryptedData.byteLength,
      "MangaMillion AES encrypted input copy"
    )
    decryptedLease = liveResourceLedger.reserve(
      encryptedData.byteLength,
      "MangaMillion AES decrypted output"
    )

    const cryptoKey = await globalThis.crypto.subtle.importKey(
      "raw",
      keyBytes as unknown as BufferSource,
      { name: "AES-CBC" },
      false,
      ["decrypt"]
    )

    const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
      { name: "AES-CBC", iv: ivBytes as unknown as BufferSource },
      cryptoKey,
      encryptedData
    )
    if (decryptedBuffer.byteLength > MAX_IMAGE_BYTES) {
      throw new ProviderContractError(
        `MangaMillion decrypted image exceeds ${MAX_IMAGE_BYTES} byte limit`
      )
    }

    const { mimeType, extension } = detectImageMimeTypeAndExt(
      new Uint8Array(decryptedBuffer)
    )
    inputCopyLease.release()
    inputCopyLease = undefined
    decryptedLease.resize(decryptedBuffer.byteLength)
    const liveResourceLease = decryptedLease.transfer(
      "retained MangaMillion decrypted image"
    )
    decryptedLease = undefined
    return {
      data: decryptedBuffer,
      mimeType,
      extension,
      liveResourceLease,
    }
  } finally {
    sourceLease.release()
    inputCopyLease?.release()
    decryptedLease?.release()
  }
}
