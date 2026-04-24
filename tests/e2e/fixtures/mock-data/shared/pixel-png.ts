/**
 * @file pixel-png.ts
 * @description Shared PNG byte fixtures used by Phase-3 e2e image routes.
 *
 * Every site integration's mocked image host serves these bytes. The fixture
 * is deliberately tiny (1x1 transparent) so:
 *
 * - Network payload stays negligible.
 * - Integrations that descramble via `createImageBitmap` + `OffscreenCanvas`
 *   (Pixiv Comic, Shonen Jump+) fall through the "too-small" guard and
 *   return the bytes unchanged. The download pipeline still receives a
 *   valid PNG, so archive assembly + OPFS write complete successfully.
 * - Archive assembly (fflate) produces a well-formed ZIP/CBZ the spec can
 *   verify via OPFS directory inspection.
 */
import { Buffer } from 'node:buffer';

// Standard 67-byte 1x1 transparent RGBA PNG. Base64 payload is byte-for-byte
// reproducible; do not hand-edit — regenerate with a PNG encoder if you need
// a different pixel and paste the new base64 here.
const SMALL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

export const SMALL_PNG_BYTES: Buffer = Buffer.from(SMALL_PNG_BASE64, 'base64');
export const SMALL_PNG_MIME_TYPE = 'image/png';

/**
 * Convenience: Playwright's `route.fulfill` accepts Buffer for `body`. Using
 * a fresh buffer per call avoids cross-request mutation should a handler
 * ever wrap the payload.
 */
export function cloneSmallPngBytes(): Buffer {
  return Buffer.from(SMALL_PNG_BYTES);
}
