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

export function detectImageMimeTypeAndExt(data: Uint8Array): {
  mimeType: string
  extension: string
} {
  if (data.length >= 12) {
    if (
      data[0] === 0x52 &&
      data[1] === 0x49 &&
      data[2] === 0x46 &&
      data[3] === 0x46 &&
      data[8] === 0x57 &&
      data[9] === 0x45 &&
      data[10] === 0x42 &&
      data[11] === 0x50
    ) {
      return { mimeType: "image/webp", extension: ".webp" }
    }

    if (
      data[4] === 0x66 &&
      data[5] === 0x74 &&
      data[6] === 0x79 &&
      data[7] === 0x70 &&
      data[8] === 0x61 &&
      data[9] === 0x76 &&
      data[10] === 0x69 &&
      data[11] === 0x66
    ) {
      return { mimeType: "image/avif", extension: ".avif" }
    }
  }

  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return { mimeType: "image/jpeg", extension: ".jpg" }
  }

  if (
    data.length >= 4 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return { mimeType: "image/png", extension: ".png" }
  }

  return { mimeType: "image/webp", extension: ".webp" }
}

export async function decryptPageImage(
  encryptedData: ArrayBuffer,
  hexKey: string,
  hexIv: string
): Promise<{
  data: ArrayBuffer
  mimeType: string
  extension: string
}> {
  const keyBytes = hexToBytes(hexKey)
  const ivBytes = hexToBytes(hexIv)

  if (keyBytes.length !== 32 || ivBytes.length !== 16) {
    throw new Error(
      `Invalid AES key/IV lengths: key ${keyBytes.length} bytes (expected 32), iv ${ivBytes.length} bytes (expected 16)`
    )
  }

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

  const { mimeType, extension } = detectImageMimeTypeAndExt(
    new Uint8Array(decryptedBuffer)
  )
  return {
    data: decryptedBuffer,
    mimeType,
    extension,
  }
}
