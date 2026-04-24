/**
 * @file api-fixtures.ts
 * @description Manhuagui script + packed-payload builders used by Phase-3
 * download-workflow mocks.
 *
 * Manhuagui's reader stack has two moving parts beyond the series HTML:
 *
 * 1. `config_{n}.js` on `cf.mhgui.com` — declares the image-host service
 *    list (`_picserv`-shaped). `fetchReaderConfig` parses it to pick a
 *    `{host}.hamreus.com` subdomain.
 * 2. The chapter viewer embeds a P.A.C.K.E.R.-packed `SMH.imgData({...})`
 *    call inside a `window["eval"](function(p,a,c,k,e,d){...}(...))` block
 *    that `chapter-viewer.ts` extracts.
 *
 * The packed-payload builder here produces the *simplest valid* shape that
 * matches the production regex: `count=1` with a one-entry lz-string
 * dictionary whose only token doesn't appear in the template, so token
 * substitution is a no-op and we can write plain JSON directly in the
 * template. (Using `count=0` with empty rawKeys doesn't work because
 * `decompressFromBase64('')` returns `null`, which the unpacker treats
 * as a decode failure.)
 */

import { compressToBase64 } from '../../../../../shared/manhuagui-compress';
import { MANHUAGUI_CONFIG_SCRIPT_DOMAIN } from '../../../test-domains-constants';

/**
 * URL path the mock serves the reader-config script at. Matches the regex
 * `chapter-viewer` uses: `<script src=".../scripts/config_*.js">`.
 */
export const MANHUAGUI_CONFIG_SCRIPT_PATH = '/scripts/config_16.js';
export const MANHUAGUI_CONFIG_SCRIPT_URL = `https://${MANHUAGUI_CONFIG_SCRIPT_DOMAIN}${MANHUAGUI_CONFIG_SCRIPT_PATH}`;

/**
 * Single image host the mock uses. `i.hamreus.com` is the lowest-weighted
 * default host in production; pinning to a single host keeps the Playwright
 * route pattern narrow.
 */
export const MANHUAGUI_MOCK_IMAGE_HOST = 'i';
export const MANHUAGUI_MOCK_IMAGE_DOMAIN = `${MANHUAGUI_MOCK_IMAGE_HOST}.hamreus.com`;

/**
 * Minimal reader-config script. The parser in
 * `src/site-integrations/manhuagui/reader-config.ts` only reads three
 * tokens from the response: `picserv`-style `{name,hosts}` blocks,
 * `curServ:N`, and `curHost:N`. Everything else is free-form — so we ship
 * a one-line IIFE that assigns the shape the parser expects.
 */
export function buildManhuaguiReaderConfigScript(): string {
  return `;var _cfg={curServ:0,curHost:0,picserv:[{name:"自动",hosts:[{h:"${MANHUAGUI_MOCK_IMAGE_HOST}",w:1}]}]};`;
}

export interface ManhuaguiPackedImageData {
  path: string;
  files: string[];
  sl: {
    e: string;
    m: string;
  };
}

/**
 * Placeholder dictionary entry used to produce a non-empty lz-string
 * rawKeys payload. The production `decompressFromBase64` returns `null`
 * for empty input, so we must supply at least one compressible token
 * even though the template never references it. The token is chosen to
 * be alphanumeric (so `\b\w+\b` tokenization is stable) and unlikely to
 * appear in any JSON payload.
 */
const MANHUAGUI_UNUSED_PACKED_TOKEN = 'zzzmockdictzzz';

/**
 * Build a packed `window["eval"](function(p,a,c,k,e,d){...}(...))` block
 * that, when the chapter-viewer extractor applies its regex + dictionary
 * substitution, yields a call to `SMH.imgData({...}).preInit()` with the
 * supplied payload.
 *
 * The unpacker walks `template.replace(/\b\w+\b/g, ...)` where the
 * dictionary is built from `count` keys split out of the fourth argument.
 * We supply a single-entry dictionary whose only token doesn't appear in
 * the template — every `\w+` token in `template` therefore stays as-is.
 * Using `count=0` with empty rawKeys would also skip substitution, but
 * `decompressFromBase64('')` returns `null` and the unpacker treats that
 * as a decode failure, so we must use `count=1` + a valid compressed
 * dictionary instead.
 */
export function buildManhuaguiPackedPayloadScript(imgData: ManhuaguiPackedImageData): string {
  // JSON.stringify guarantees both valid JSON AND no single-quote characters
  // that would otherwise terminate the outer 'TEMPLATE' literal prematurely.
  const jsonPayload = JSON.stringify(imgData);
  const template = `SMH.imgData(${jsonPayload}).preInit()`;
  const rawKeys = compressToBase64(MANHUAGUI_UNUSED_PACKED_TOKEN);
  return `window["eval"](function(p,a,c,k,e,d){return p}('${template}',10,1,'${rawKeys}'['split']('|'),0,{}))`;
}

/**
 * Per-chapter signed-URL metadata the mocked pipeline uses. Values match
 * the real chapter viewer's schema (`sl.e` = expiry epoch string, `sl.m`
 * = signature). The mocked image host ignores these entirely — they only
 * need to deserialize.
 */
export function buildManhuaguiChapterSlMetadata(chapterId: string): { e: string; m: string } {
  return {
    // Epoch in the distant future so no downstream validator ever treats
    // the URL as expired.
    e: '9999999999',
    m: `mock-sig-${chapterId}`,
  };
}

/**
 * Base path segment the signed image URL resolves against. Manhuagui's
 * real paths look like `ps1/f/comic/{series}/{chapter}_SOMETHING/`; the
 * mock mirrors that structure so the production path normalizer has a
 * realistic input to sanitize.
 */
export function buildManhuaguiChapterPathSegment(seriesId: string, chapterId: string): string {
  return `/ps1/f/mock/${seriesId}/${chapterId}/`;
}
