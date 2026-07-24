export function sanitizeLabel(raw: string): string {
  let cleaned = ""

  for (const char of raw) {
    const code = char.charCodeAt(0)
    const isControlChar = (code >= 0 && code <= 31) || code === 127
    cleaned += isControlChar ? " " : char
  }

  return cleaned.replace(/\s+/g, " ").trim()
}

export function normalizeNumericText(value: string): string {
  return value.replace(/[０-９．]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  )
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
 * Drop entries that cannot be parsed as absolute HTTP(S) URLs.
 *
 * Every site integration's `processImageUrls` hook needs to discard malformed
 * entries before they reach the downloader. Extension download paths fetch
 * remote image assets; non-network schemes such as `data:`, `blob:`, `file:`,
 * and extension URLs must not cross that boundary.
 */
export function filterValidImageUrls(urls: string[]): string[] {
  return urls.filter((url) => {
    try {
      const parsed = new URL(url)
      return parsed.protocol === "https:" || parsed.protocol === "http:"
    } catch {
      return false
    }
  })
}

const ALLOWED_RASTER_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
])

export function normalizeAllowedImageMimeType(
  rawContentType: string | null | undefined
): string {
  const mimeType =
    sanitizeLabel(rawContentType ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase() ?? ""

  if (!ALLOWED_RASTER_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error(`Unsupported MIME type: ${mimeType || "missing"}`)
  }

  return mimeType
}

export function parseVolumeInfo(text: string): {
  volumeLabel?: string
  volumeNumber?: number
} {
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

/**
 * Parse standard HTTP Retry-After or provider-specific rate-limit headers.
 * Supports:
 * 1. Standard HTTP 'Retry-After' (relative seconds or absolute HTTP-date)
 * 2. Provider-specific 'X-RateLimit-Retry-After' (UNIX timestamp in seconds)
 *
 * Returns the parsed delay in milliseconds, or null if headers are missing/invalid.
 */
export function parseRateLimitRetryAfterHeader(
  headers: { get(name: string): string | null } | Record<string, string>,
  clampFn?: (ms: number) => number
): number | null {
  const getHeader = (name: string): string | null => {
    const maybeHeaders = headers as { get?(name: string): string | null }
    if (typeof maybeHeaders.get === "function") {
      return maybeHeaders.get(name)
    }
    const record = headers as Record<string, string>
    return record[name] ?? record[name.toLowerCase()] ?? null
  }

  // 1. Check standard HTTP Retry-After
  const retryAfter = getHeader("Retry-After")
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds)) {
      const ms = seconds * 1000
      return clampFn ? clampFn(ms) : ms
    }

    const timestamp = Date.parse(retryAfter)
    if (!Number.isNaN(timestamp)) {
      const ms = timestamp - Date.now()
      return clampFn ? clampFn(ms) : ms
    }
  }

  // 2. Check provider-specific X-RateLimit-Retry-After
  const xRetryAfter = getHeader("X-RateLimit-Retry-After")
  if (xRetryAfter) {
    const timestamp = parseInt(xRetryAfter, 10)
    if (!Number.isNaN(timestamp)) {
      const ms = timestamp * 1000 - Date.now()
      return clampFn ? clampFn(ms) : ms
    }
  }

  return null
}
