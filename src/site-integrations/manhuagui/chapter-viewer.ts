import { sanitizeLabel } from '@/src/shared/site-integration-utils';
import { decompressFromBase64 } from './lz-string';
import {
  fetchReaderConfig,
  selectReaderHost,
  type ReaderConfig,
} from './reader-config';
import { DEFAULT_IMAGE_PROTOCOL } from './shared';

/**
 * The subset of `SMH.imgData({...})` fields the viewer URL builder consumes.
 * - `files`: image filenames in reading order
 * - `path`: hamreus.com base path (or absolute URL) for the chapter directory
 * - `sl`: `{ e: expiryEpoch, m: signature }` used for the signed query string
 */
type PackedImageData = {
  files?: unknown;
  path?: unknown;
  sl?: {
    e?: unknown;
    m?: unknown;
  };
};

/**
 * Raw P.A.C.K.E.R. payload tuple extracted from the chapter HTML before
 * dictionary substitution. `template` is the compressed JavaScript literal,
 * `radix` and `count` are the base and dictionary length, and `rawKeys` is the
 * base64 lz-string-compressed `|`-separated dictionary body.
 */
type PackedPayloadTemplate = {
  template: string;
  radix: number;
  count: number;
  rawKeys: string;
};

// Matches the `window["eval"]((function(p,a,c,k,e,d){...}('<template>',<radix>,<count>,'<keys>'.split('|'),0,{}))`
// unpacker invocation Manhuagui's chapter viewer emits. The capture order is
// carefully aligned with `extractPackedPayloadTemplate` below.
const PACKED_PAYLOAD_REGEX = /window\[[^\]]+\]\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\[[\s\S]*?\]\([\s\S]*?\),0,\{\}\)\)/s;

// Markers present in the age-warning HTML Manhuagui serves when the
// `isAdult=1` cookie is missing. Used to distinguish "format changed" from
// "age-gate not bypassed" so bug reports point at the right cause.
const AGE_GATE_MARKERS = ['id="checkAdult"', "id='checkAdult'", 'showAdultInfo()', 'isAdult=1'];

/**
 * Decode escape sequences present in a JavaScript single-quoted string
 * literal (`\xNN`, `\uNNNN`, `\"`, `\'`, `\\`). Used before template
 * substitution so byte-for-byte content survives the regex capture.
 */
function decodeJavaScriptStringLiteral(value: string): string {
  return value
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\'/g, '\'')
    .replace(/\\\\/g, '\\');
}

function isAgeGatedChapterHtml(chapterHtml: string): boolean {
  return AGE_GATE_MARKERS.some((marker) => chapterHtml.includes(marker));
}

function extractPackedPayloadTemplate(chapterHtml: string): PackedPayloadTemplate {
  const packedMatch = chapterHtml.match(PACKED_PAYLOAD_REGEX);
  if (!packedMatch) {
    if (isAgeGatedChapterHtml(chapterHtml)) {
      throw new Error(
        'Manhuagui age-gate not bypassed: isAdult cookie was not honored for this chapter fetch. '
        + 'Ensure the background service worker set the cookie before fetching.',
      );
    }
    throw new Error('Manhuagui viewer format changed (packed image data missing)');
  }

  const [, templateLiteral, radixText, countText, rawKeys] = packedMatch;
  if (!templateLiteral || !radixText || !countText || rawKeys == null) {
    throw new Error('Manhuagui viewer format changed (packed image data incomplete)');
  }

  return {
    template: decodeJavaScriptStringLiteral(templateLiteral),
    radix: Number.parseInt(radixText, 10),
    count: Number.parseInt(countText, 10),
    rawKeys,
  };
}

/**
 * Walk the unpacked JavaScript source and slice out the first balanced JSON
 * object that immediately follows `marker` (e.g. `imgData(`). Needed because
 * the template is a JS expression and we cannot use `JSON.parse` on the whole
 * body.
 */
function extractBalancedJsonObject(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error('Manhuagui viewer format changed (imgData call missing)');
  }

  const startIndex = source.indexOf('{', markerIndex + marker.length);
  if (startIndex < 0) {
    throw new Error('Manhuagui viewer format changed (imgData payload missing)');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (!char) {
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char !== '}') {
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      return source.slice(startIndex, index + 1);
    }
  }

  throw new Error('Manhuagui viewer format changed (imgData payload unbalanced)');
}

/**
 * Reverse the P.A.C.K.E.R. substitution by rebuilding the dictionary from
 * `rawKeys` (lz-string base64) and replacing every `\w+` token in the
 * template, then slicing out the `imgData({...})` argument as JSON.
 */
function parsePackedPayloadTemplate(template: string, radix: number, count: number, rawKeys: string): PackedImageData {
  const keyText = decompressFromBase64(rawKeys);
  if (keyText == null) {
    throw new Error('Unable to decompress packed image payload');
  }

  const keys = keyText.split('|');
  const dictionary: Record<string, string> = {};

  const encodeIndex = (value: number): string => {
    const prefix = value < radix ? '' : encodeIndex(Math.floor(value / radix));
    const remainder = value % radix;
    const suffix = remainder > 35
      ? String.fromCharCode(remainder + 29)
      : remainder.toString(36);
    return `${prefix}${suffix}`;
  };

  for (let index = count - 1; index >= 0; index -= 1) {
    const key = encodeIndex(index);
    dictionary[key] = keys[index] || key;
  }

  const jsonText = template.replace(/\b\w+\b/g, (token) => dictionary[token] ?? token);
  return JSON.parse(extractBalancedJsonObject(jsonText, 'imgData(')) as PackedImageData;
}

function parsePackedImageData(chapterHtml: string): PackedImageData {
  const packedTemplate = extractPackedPayloadTemplate(chapterHtml);
  return parsePackedPayloadTemplate(
    packedTemplate.template,
    packedTemplate.radix,
    packedTemplate.count,
    packedTemplate.rawKeys,
  );
}

function normalizeImagePath(path: string): string {
  const cleaned = sanitizeLabel(path).replace(/^\/+/, '');
  if (!cleaned) {
    throw new Error('Manhuagui viewer format changed (image path missing)');
  }

  return cleaned;
}

/**
 * Produce the directory-level base URL an image filename is appended to,
 * honoring any absolute `path` the packed data supplies and otherwise
 * selecting a `{host}.hamreus.com` base from the reader config.
 */
function buildReaderFilePath(basePath: string, readerConfig: ReaderConfig): string {
  const normalizedPath = sanitizeLabel(basePath);
  if (!normalizedPath) {
    throw new Error('Manhuagui viewer format changed (image path missing)');
  }

  if (/^https?:\/\//i.test(normalizedPath)) {
    return normalizedPath.endsWith('/') ? normalizedPath : `${normalizedPath}/`;
  }

  if (normalizedPath.startsWith('//')) {
    const absoluteUrl = `${DEFAULT_IMAGE_PROTOCOL}${normalizedPath}`;
    return absoluteUrl.endsWith('/') ? absoluteUrl : `${absoluteUrl}/`;
  }

  const hostName = selectReaderHost(readerConfig);
  return `${DEFAULT_IMAGE_PROTOCOL}//${hostName}.hamreus.com/${normalizeImagePath(normalizedPath).replace(/\/?$/, '/')}`;
}

function buildImageUrl(basePath: string, filename: string, expiresAt: string, signature: string): string {
  const normalizedFilename = sanitizeLabel(filename);
  if (!normalizedFilename) {
    throw new Error('Manhuagui viewer format changed (image filename missing)');
  }

  const normalizedBasePath = basePath.endsWith('/') ? basePath : `${basePath}/`;
  return `${normalizedBasePath}${normalizedFilename}?e=${encodeURIComponent(expiresAt)}&m=${encodeURIComponent(signature)}`;
}

function extractImageUrlsFromPackedData(data: PackedImageData, readerConfig: ReaderConfig): string[] {
  const files = Array.isArray(data.files)
    ? data.files.filter((value): value is string => typeof value === 'string' && sanitizeLabel(value).length > 0)
    : [];
  const basePath = typeof data.path === 'string' ? buildReaderFilePath(data.path, readerConfig) : '';
  const expiresAt = typeof data.sl?.e === 'string' || typeof data.sl?.e === 'number' ? String(data.sl.e) : '';
  const signature = typeof data.sl?.m === 'string' || typeof data.sl?.m === 'number' ? String(data.sl.m) : '';

  if (!basePath || !expiresAt || !signature || files.length === 0) {
    throw new Error('Manhuagui viewer format changed (image metadata incomplete)');
  }

  return files.map((filename) => buildImageUrl(basePath, filename, expiresAt, signature));
}

/**
 * Convert chapter viewer HTML into the ordered list of signed image URLs.
 *
 * Two fetches are issued concurrently: the packed payload is decoded locally
 * (synchronous) while the external `config_*.js` is fetched to determine the
 * image host. If the config script fails to load we fall back to
 * {@link DEFAULT_READER_CONFIG} so the packed payload alone is enough to
 * produce URLs.
 */
export async function resolveImageUrlsFromChapterHtml(chapterHtml: string): Promise<string[]> {
  const [packedImageData, readerConfig] = await Promise.all([
    Promise.resolve(parsePackedImageData(chapterHtml)),
    fetchReaderConfig(chapterHtml),
  ]);

  return extractImageUrlsFromPackedData(packedImageData, readerConfig);
}
