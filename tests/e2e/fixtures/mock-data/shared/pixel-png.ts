/** A 1×1 transparent PNG for routes that do not exercise image transforms. */
import { Buffer } from "node:buffer"

// Regenerate with a PNG encoder when changing the pixel.
const SMALL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII="

export const SMALL_PNG_BYTES: Buffer = Buffer.from(SMALL_PNG_BASE64, "base64")
export const SMALL_PNG_MIME_TYPE = "image/png"

/** Return a fresh buffer so handlers cannot mutate another request’s bytes. */
export function cloneSmallPngBytes(): Buffer {
  return Buffer.from(SMALL_PNG_BYTES)
}
