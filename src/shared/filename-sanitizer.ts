/** Maximum UTF-16 length of a sanitized filename. */
export const MAX_FILENAME_LENGTH = 200
// Reserve room for extensions and duplicate-name suffixes.
const MAX_FILENAME_BYTES = 240

function truncateFilename(filename: string): string {
  const encoder = new TextEncoder()
  let length = 0
  let bytes = 0
  for (const character of filename) {
    const nextLength = length + character.length
    const nextBytes = bytes + encoder.encode(character).byteLength
    if (nextLength > MAX_FILENAME_LENGTH || nextBytes > MAX_FILENAME_BYTES) {
      break
    }
    length = nextLength
    bytes = nextBytes
  }
  return filename.slice(0, length)
}

/** Replace unsafe filename characters and bound the result without splitting characters. */
export function sanitizeFilename(filename: string): string {
  if (typeof filename !== "string") {
    return ""
  }

  // Use the Windows character restrictions for portable filenames.
  // eslint-disable-next-line no-useless-escape
  const illegalRe = /[<>:"\/\\|?*]/g
  // eslint-disable-next-line no-control-regex
  const controlRe = /[\x00-\x1f\x80-\x9f]/g
  const reservedRe = /^\.+$/
  // Device names remain reserved when followed by an extension.
  const windowsReservedRe = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i
  // Windows doesn't allow trailing dots or spaces
  // eslint-disable-next-line no-useless-escape
  const windowsTrailingRe = /[\. ]+$/

  let sanitized = filename
    .replace(illegalRe, "_")
    .replace(controlRe, "_")
    .replace(reservedRe, "_")
    .replace(windowsReservedRe, "_")

  sanitized = truncateFilename(sanitized)

  // Truncation can expose a trailing dot or space that was previously interior.
  return sanitized.replace(windowsTrailingRe, "_")
}

/** Convert a zero-based image index to a padded filename with its MIME extension. */
export function normalizeImageFilename(
  index: number,
  totalImages: number,
  mimeType: string,
  paddingDigits: "auto" | 2 | 3 | 4 | 5 = "auto"
): string {
  const digits =
    paddingDigits === "auto" ? String(totalImages).length : paddingDigits

  const imageNumber = index + 1
  const paddedIndex = String(imageNumber).padStart(digits, "0")

  const extension = getExtensionFromMimeType(mimeType)

  return `${paddedIndex}.${extension}`
}

/** Return a supported image extension; reject unknown MIME types. */
export function getExtensionFromMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg"
    case "image/png":
      return "png"
    case "image/webp":
      return "webp"
    case "image/gif":
      return "gif"
    default:
      throw new Error(`Unsupported image MIME type: ${mimeType || "missing"}`)
  }
}
