import { NonRetryableDownloadError } from "@/src/shared/download-contract"

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

const ALLOWED_RASTER_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
])

export function assertNonemptyImagePayload(data: ArrayBuffer): void {
  if (data.byteLength === 0) {
    throw new Error("Image payload is empty")
  }
}

const ENCODED_IMAGE_MIME_TYPES = new Set([
  "image/avif",
  "application/octet-stream",
  "binary/octet-stream",
])

export function normalizeAllowedImageMimeType(
  rawContentType: string | null | undefined,
  options: { allowEncodedImageMimeType?: boolean } = {}
): string {
  const mimeType = sanitizeLabel(rawContentType ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase()
  const allowed =
    ALLOWED_RASTER_IMAGE_MIME_TYPES.has(mimeType) ||
    (options.allowEncodedImageMimeType &&
      ENCODED_IMAGE_MIME_TYPES.has(mimeType))
  if (!allowed) {
    throw new NonRetryableDownloadError(
      `Unsupported MIME type: ${mimeType || "missing"}`
    )
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

type RateLimitHeaders =
  { get(name: string): string | null } | Record<string, string>

function readRateLimitHeader(
  headers: RateLimitHeaders,
  name: string
): string | null {
  const maybeHeaders = headers as { get?(name: string): string | null }
  if (typeof maybeHeaders.get === "function") return maybeHeaders.get(name)
  const record = headers as Record<string, string>
  return record[name] ?? record[name.toLowerCase()] ?? null
}

function parseStandardRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return seconds * 1000
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? null : timestamp - Date.now()
}

function parseProviderRetryAfter(value: string | null): number | null {
  if (!value) return null
  const timestamp = parseInt(value, 10)
  return Number.isNaN(timestamp) ? null : timestamp * 1000 - Date.now()
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
  headers: RateLimitHeaders,
  clampFn?: (ms: number) => number
): number | null {
  const delay =
    parseStandardRetryAfter(readRateLimitHeader(headers, "Retry-After")) ??
    parseProviderRetryAfter(
      readRateLimitHeader(headers, "X-RateLimit-Retry-After")
    )
  if (delay === null) return null
  return clampFn ? clampFn(delay) : delay
}
