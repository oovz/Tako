/** A complete square tile permutation shared by protocol and transport parsing. */
export function isMangagoTilePermutation(
  grid: number[],
  columns: number
): boolean {
  return (
    grid.length === columns * columns &&
    new Set(grid).size === grid.length &&
    grid.every(
      (entry) => Number.isInteger(entry) && entry >= 0 && entry < grid.length
    )
  )
}
