/** Manhuagui filenames and chapter layouts shared by reader and image routes. */

/**
 * One image per chapter keeps the mocked download pipeline negligible.
 * The unpacker's behavior is invariant to page count, so a single file
 * exercises every code path.
 */
export const MOCK_IMAGES_PER_CHAPTER = 1

export function buildManhuaguiImageFilenames(
  count: number = MOCK_IMAGES_PER_CHAPTER
): string[] {
  return Array.from({ length: count }, (_, index) => `${index + 1}.png`)
}
