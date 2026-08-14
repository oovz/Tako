/**
 * @file index.ts
 * @description Barrel for cross-integration shared mock primitives.
 *
 * Download-workflow additions:
 * - {@link SMALL_PNG_BYTES} / {@link cloneSmallPngBytes}: deterministic PNG
 *   bytes every integration's image route serves.
 */

export {
  SMALL_PNG_BYTES,
  SMALL_PNG_MIME_TYPE,
  cloneSmallPngBytes,
} from "./pixel-png"
