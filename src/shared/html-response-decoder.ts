import { MAX_METADATA_RESPONSE_BYTES } from "@/src/constants/timeouts"
import { NonRetryableDownloadError } from "./download-contract"
import { cancelResponseBody } from "./response-body"

const DEFAULT_META_SCAN_BYTES = 1024

type EncodingSource = "bom" | "header" | "meta"

export interface DecodeHtmlOptions {
  contentType?: string | null
  scanByteLimit?: number
  maxBytes?: number
}

export interface DecodedHtmlDocument {
  html: string
  encoding: string
  source: EncodingSource
}

function normalizeEncodingLabel(
  label: string | null | undefined
): string | undefined {
  if (typeof label !== "string") {
    return undefined
  }

  const normalized = label
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .toLowerCase()
  return normalized.length > 0 ? normalized : undefined
}

function getCharsetFromContentType(
  contentType: string | null | undefined
): string | undefined {
  const normalized = typeof contentType === "string" ? contentType : ""
  const match = normalized.match(/charset\s*=\s*([^;\s]+)/i)
  return normalizeEncodingLabel(match?.[1])
}

const BYTE_ORDER_MARKS: ReadonlyArray<readonly [readonly number[], string]> = [
  [[0xef, 0xbb, 0xbf], "utf-8"],
  [[0xff, 0xfe], "utf-16le"],
  [[0xfe, 0xff], "utf-16be"],
]

function getBomEncoding(bytes: Uint8Array): string | undefined {
  return BYTE_ORDER_MARKS.find(([signature]) =>
    signature.every((byte, index) => bytes[index] === byte)
  )?.[1]
}

function getAsciiPrefix(bytes: Uint8Array, scanByteLimit: number): string {
  const limit = Math.min(bytes.length, scanByteLimit)
  let prefix = ""

  for (let index = 0; index < limit; index += 1) {
    const byte = bytes[index] ?? 0
    prefix += byte <= 0x7f ? String.fromCharCode(byte) : " "
  }

  return prefix
}

function getCharsetFromHtmlMeta(
  bytes: Uint8Array,
  scanByteLimit: number
): string | undefined {
  const prefix = getAsciiPrefix(bytes, scanByteLimit)
  const metaCharsetMatch = prefix.match(
    /<meta\b[^>]*charset\s*=\s*['"]?\s*([^\s'"/>;]+)/i
  )
  if (metaCharsetMatch?.[1]) {
    return normalizeEncodingLabel(metaCharsetMatch[1])
  }

  const httpEquivMatch = prefix.match(
    /<meta\b[^>]*http-equiv\s*=\s*['"]content-type['"][^>]*content\s*=\s*['"][^'"]*charset\s*=\s*([^\s'"/>;]+)/i
  )
  if (httpEquivMatch?.[1]) {
    return normalizeEncodingLabel(httpEquivMatch[1])
  }

  const contentFirstMatch = prefix.match(
    /<meta\b[^>]*content\s*=\s*['"][^'"]*charset\s*=\s*([^\s'"/>;]+)[^'"]*['"][^>]*http-equiv\s*=\s*['"]content-type['"]/i
  )
  if (contentFirstMatch?.[1]) {
    return normalizeEncodingLabel(contentFirstMatch[1])
  }

  return undefined
}

/**
 * Decode HTML only from explicitly declared encoding metadata.
 *
 * The downloader does not guess a default charset or retry multiple encodings.
 * A supported BOM, HTTP charset, or HTML meta charset must be present.
 */
function decodeWithEncoding(bytes: Uint8Array, encoding: string): string {
  return new TextDecoder(encoding, { fatal: true }).decode(bytes)
}

export function decodeHtmlBytes(
  bytes: Uint8Array,
  options: DecodeHtmlOptions = {}
): DecodedHtmlDocument {
  const { encoding, source } = resolveHtmlEncoding(bytes, options)

  try {
    return {
      html: decodeWithEncoding(bytes, encoding),
      encoding,
      source,
    }
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown decode error"
    throw new NonRetryableDownloadError(
      `Failed to decode HTML response with declared encoding "${encoding}" from ${source}: ${reason}`,
      { cause: error }
    )
  }
}

function resolveHtmlEncoding(
  bytes: Uint8Array,
  options: DecodeHtmlOptions
): { encoding: string; source: EncodingSource } {
  const bom = getBomEncoding(bytes)
  const header = getCharsetFromContentType(options.contentType)
  const meta = getCharsetFromHtmlMeta(
    bytes,
    options.scanByteLimit ?? DEFAULT_META_SCAN_BYTES
  )
  if (bom) return { encoding: bom, source: "bom" }
  if (header) return { encoding: header, source: "header" }
  if (meta) return { encoding: meta, source: "meta" }
  throw new NonRetryableDownloadError(
    "Unable to decode HTML response: no supported charset declaration found in BOM, Content-Type, or <meta charset>"
  )
}

export class ResponseBodyLimitError extends NonRetryableDownloadError {
  constructor(maxBytes: number, actualBytes?: number) {
    super(
      actualBytes === undefined
        ? `Response body exceeds ${maxBytes} byte limit`
        : `Response body exceeds ${maxBytes} byte limit (got ${actualBytes})`
    )
    this.name = "ResponseBodyLimitError"
  }
}

function boundedResponseBytes(bytes: Uint8Array, limit: number): Uint8Array {
  if (bytes.byteLength > limit)
    throw new ResponseBodyLimitError(limit, bytes.byteLength)
  return bytes
}

async function readUnstreamedResponseBytes(
  response: Response
): Promise<Uint8Array> {
  const contentType = response.headers?.get?.("content-type") ?? ""
  if (
    contentType.toLowerCase().includes("javascript") &&
    typeof response.arrayBuffer === "function"
  ) {
    return new Uint8Array(await response.arrayBuffer())
  }
  if (typeof response.text === "function") {
    return new TextEncoder().encode(await response.text())
  }
  if (typeof response.json === "function") {
    return new TextEncoder().encode(JSON.stringify(await response.json()))
  }
  return new Uint8Array(await response.arrayBuffer())
}

async function readResponseStream(
  body: ReadableStream<Uint8Array>,
  limit: number
): Promise<Uint8Array> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      if (!result.value || result.value.byteLength === 0) continue
      totalBytes += result.value.byteLength
      if (totalBytes > limit) {
        const error = new ResponseBodyLimitError(limit, totalBytes)
        void reader.cancel(error).catch(() => undefined)
        throw error
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function readResponseBytes(
  response: Response,
  maxBytes: number = MAX_METADATA_RESPONSE_BYTES
): Promise<Uint8Array> {
  const limit = Math.max(0, Math.trunc(maxBytes))
  const contentLength = Number(
    response.headers?.get?.("content-length") ?? Number.NaN
  )
  if (Number.isFinite(contentLength) && contentLength > limit) {
    const error = new ResponseBodyLimitError(limit, contentLength)
    cancelResponseBody(response, error)
    throw error
  }
  if (!response.body) {
    return boundedResponseBytes(
      await readUnstreamedResponseBytes(response),
      limit
    )
  }
  return readResponseStream(response.body, limit)
}

export async function readResponseText(
  response: Response,
  maxBytes: number = MAX_METADATA_RESPONSE_BYTES
): Promise<string> {
  return new TextDecoder().decode(await readResponseBytes(response, maxBytes))
}

export async function readResponseJson(
  response: Response,
  maxBytes: number = MAX_METADATA_RESPONSE_BYTES
): Promise<unknown> {
  return JSON.parse(await readResponseText(response, maxBytes)) as unknown
}

export async function decodeHtmlResponse(
  response: Response,
  options: Omit<DecodeHtmlOptions, "contentType"> = {}
): Promise<DecodedHtmlDocument> {
  const buffer = await readResponseBytes(
    response,
    options.maxBytes ?? MAX_METADATA_RESPONSE_BYTES
  )
  return decodeHtmlBytes(new Uint8Array(buffer), {
    ...options,
    contentType: response.headers?.get?.("content-type"),
  })
}
