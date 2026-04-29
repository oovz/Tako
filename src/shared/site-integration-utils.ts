export function sanitizeLabel(raw: string): string {
  let cleaned = ''

  for (const char of raw) {
    const code = char.charCodeAt(0)
    const isControlChar = (code >= 0 && code <= 31) || code === 127
    cleaned += isControlChar ? ' ' : char
  }

  return cleaned.replace(/\s+/g, ' ').trim()
}

export function normalizeNumericText(value: string): string {
  return value.replace(/[０-９．]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
}

export function parseChapterNumber(label: string): number | undefined {
  const normalized = sanitizeLabel(label)
  if (!normalized) {
    return undefined
  }

  const parseable = normalizeNumericText(normalized)
  const match = parseable.match(/\d+(?:\.\d+)?/)
  if (!match) {
    return undefined
  }

  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Drop entries that cannot be parsed as absolute URLs.
 *
 * Every site integration's `processImageUrls` hook needs to discard malformed
 * entries before they reach the downloader (which assumes valid absolute URLs
 * when deriving filenames from pathnames). Centralizing this keeps the filter
 * behavior identical across integrations.
 */
export function filterValidImageUrls(urls: string[]): string[] {
  return urls.filter((url) => {
    try {
      new URL(url)
      return true
    } catch {
      return false
    }
  })
}

const ALLOWED_RASTER_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
])

export function normalizeAllowedImageMimeType(rawContentType: string | null | undefined): string {
  const mimeType = sanitizeLabel(rawContentType ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase() ?? ''

  if (!ALLOWED_RASTER_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error(`Unsupported MIME type: ${mimeType || 'missing'}`)
  }

  return mimeType
}

export function parseVolumeInfo(text: string): { volumeLabel?: string; volumeNumber?: number } {
  const label = sanitizeLabel(text)
  if (!label) {
    return {}
  }

  const parseable = normalizeNumericText(label)
  const match = parseable.match(/(?:vol(?:ume)?\.?\s*)?(\d+(?:\.\d+)?)/i)
  if (!match) {
    return { volumeLabel: label }
  }

  const parsedNumber = Number(match[1])
  return {
    volumeLabel: label,
    volumeNumber: Number.isFinite(parsedNumber) ? parsedNumber : undefined,
  }
}
