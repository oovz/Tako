/**
 * @file image-fixtures.ts
 * @description Manhuagui image-host metadata used by Phase-3
 * download-workflow mocks.
 *
 * Images themselves are the shared 1x1 PNG; this module only centralizes
 * the filename and chapter-layout helpers so `routes.ts` + spec code use
 * the same source of truth when wiring up packed payloads vs. the image
 * host route.
 */

/**
 * One image per chapter keeps the mocked download pipeline negligible.
 * The unpacker's behavior is invariant to page count, so a single file
 * exercises every code path.
 */
export const MOCK_IMAGES_PER_CHAPTER = 1;

export function buildManhuaguiImageFilenames(
  count: number = MOCK_IMAGES_PER_CHAPTER,
): string[] {
  return Array.from({ length: count }, (_, index) => `${index + 1}.png`);
}
