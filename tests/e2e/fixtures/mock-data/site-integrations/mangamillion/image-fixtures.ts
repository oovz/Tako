import crypto from "node:crypto"

export const MOCK_AES_KEY =
  "8c12434255319a2a5fb903fc39994f409eb27979d1d78f1009f1a015f69db321"
export const MOCK_AES_IV = "4af66d450c1244868dc4a5cff035898c"

/** Minimal valid 1x1 WebP image buffer (38 bytes, starts with RIFF....WEBP). */
export const MOCK_PLAIN_WEBP_BUFFER = Buffer.from(
  "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==",
  "base64"
)

export const MOCK_COVER_IMAGE_BUFFER = MOCK_PLAIN_WEBP_BUFFER

export function createEncryptedPageBuffer(
  plainBuffer: Buffer = MOCK_PLAIN_WEBP_BUFFER,
  keyHex = MOCK_AES_KEY,
  ivHex = MOCK_AES_IV
): Buffer {
  const key = Buffer.from(keyHex, "hex")
  const iv = Buffer.from(ivHex, "hex")
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv)
  return Buffer.concat([cipher.update(plainBuffer), cipher.final()])
}

export const MOCK_ENCRYPTED_PAGE_BUFFER = createEncryptedPageBuffer()
