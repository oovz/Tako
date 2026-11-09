import {
  getExtensionFromMimeType,
  normalizeImageFilename,
} from "./filename-sanitizer"
import { normalizeAllowedImageMimeType } from "./site-integration-utils"

export function buildImageOutputFilename(input: {
  index: number
  totalImages: number
  originalFilename: string
  mimeType: string
  normalizeImageFilenames: boolean
  imagePaddingDigits: "auto" | 2 | 3 | 4 | 5
}): string {
  const {
    index,
    totalImages,
    originalFilename,
    mimeType,
    normalizeImageFilenames,
    imagePaddingDigits,
  } = input
  const canonicalMimeType = normalizeAllowedImageMimeType(mimeType)
  if (normalizeImageFilenames) {
    return normalizeImageFilename(
      index,
      totalImages,
      canonicalMimeType,
      imagePaddingDigits
    )
  }

  const baseFilename = originalFilename.replace(
    /\.(?:jpe?g|png|webp|gif)$/i,
    ""
  )
  return `${String(index + 1).padStart(3, "0")}-${baseFilename}.${getExtensionFromMimeType(canonicalMimeType)}`
}

export function buildCoverOutputFilename(mimeType: string): string {
  const extension = getExtensionFromMimeType(
    normalizeAllowedImageMimeType(mimeType)
  )
  return `000-cover.${extension}`
}
