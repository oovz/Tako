const DEFAULT_META_SCAN_BYTES = 1024;

type EncodingSource = 'bom' | 'header' | 'meta';

export interface DecodeHtmlOptions {
  contentType?: string | null;
  scanByteLimit?: number;
}

export interface DecodedHtmlDocument {
  html: string;
  encoding: string;
  source: EncodingSource;
}

function normalizeEncodingLabel(label: string | null | undefined): string | undefined {
  if (typeof label !== 'string') {
    return undefined;
  }

  const normalized = label.trim().replace(/^['"]+|['"]+$/g, '').toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function getCharsetFromContentType(contentType: string | null | undefined): string | undefined {
  const normalized = typeof contentType === 'string' ? contentType : '';
  const match = normalized.match(/charset\s*=\s*([^;\s]+)/i);
  return normalizeEncodingLabel(match?.[1]);
}

function getBomEncoding(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'utf-8';
  }

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return 'utf-16le';
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return 'utf-16be';
  }

  return undefined;
}

function getAsciiPrefix(bytes: Uint8Array, scanByteLimit: number): string {
  const limit = Math.min(bytes.length, scanByteLimit);
  let prefix = '';

  for (let index = 0; index < limit; index += 1) {
    const byte = bytes[index] ?? 0;
    prefix += byte <= 0x7f ? String.fromCharCode(byte) : ' ';
  }

  return prefix;
}

function getCharsetFromHtmlMeta(bytes: Uint8Array, scanByteLimit: number): string | undefined {
  const prefix = getAsciiPrefix(bytes, scanByteLimit);
  const metaCharsetMatch = prefix.match(/<meta\b[^>]*charset\s*=\s*['"]?\s*([^\s'"/>;]+)/i);
  if (metaCharsetMatch?.[1]) {
    return normalizeEncodingLabel(metaCharsetMatch[1]);
  }

  const httpEquivMatch = prefix.match(/<meta\b[^>]*http-equiv\s*=\s*['"]content-type['"][^>]*content\s*=\s*['"][^'"]*charset\s*=\s*([^\s'"/>;]+)/i);
  if (httpEquivMatch?.[1]) {
    return normalizeEncodingLabel(httpEquivMatch[1]);
  }

  const contentFirstMatch = prefix.match(/<meta\b[^>]*content\s*=\s*['"][^'"]*charset\s*=\s*([^\s'"/>;]+)[^'"]*['"][^>]*http-equiv\s*=\s*['"]content-type['"]/i);
  if (contentFirstMatch?.[1]) {
    return normalizeEncodingLabel(contentFirstMatch[1]);
  }

  return undefined;
}

/**
 * Decode HTML only from explicitly declared encoding metadata.
 *
 * The downloader does not guess a default charset or retry multiple encodings.
 * A supported BOM, HTTP charset, or HTML meta charset must be present.
 */
function decodeWithEncoding(bytes: Uint8Array, encoding: string): string {
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

export function decodeHtmlBytes(bytes: Uint8Array, options: DecodeHtmlOptions = {}): DecodedHtmlDocument {
  const bomEncoding = getBomEncoding(bytes);
  const headerEncoding = getCharsetFromContentType(options.contentType);
  const metaEncoding = getCharsetFromHtmlMeta(bytes, options.scanByteLimit ?? DEFAULT_META_SCAN_BYTES);

  const encoding = bomEncoding ?? headerEncoding ?? metaEncoding;
  const source: EncodingSource | undefined = bomEncoding
    ? 'bom'
    : headerEncoding
      ? 'header'
      : metaEncoding
        ? 'meta'
        : undefined;

  if (!encoding || !source) {
    throw new Error('Unable to decode HTML response: no supported charset declaration found in BOM, Content-Type, or <meta charset>');
  }

  try {
    return {
      html: decodeWithEncoding(bytes, encoding),
      encoding,
      source,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown decode error';
    throw new Error(`Failed to decode HTML response with declared encoding "${encoding}" from ${source}: ${reason}`);
  }
}

export async function decodeHtmlResponse(response: Response, options: Omit<DecodeHtmlOptions, 'contentType'> = {}): Promise<DecodedHtmlDocument> {
  const buffer = await response.arrayBuffer();
  return decodeHtmlBytes(new Uint8Array(buffer), {
    ...options,
    contentType: response.headers.get('content-type'),
  });
}
