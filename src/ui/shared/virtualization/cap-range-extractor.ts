/**
 * Virtualizer range extractor that caps overscan rows.
 *
 * TanStack Virtual's range extractor decides which indexes are mounted. Every
 * index in `startIndex..endIndex` is viewport-visible and must be returned;
 * otherwise the list can show blank gaps. This helper trims only extra overscan
 * indexes when the requested range is over budget. If the visible range itself
 * exceeds `maxItems`, visible correctness wins and the returned range exceeds
 * the target cap.
 */
import { defaultRangeExtractor, type Range } from '@tanstack/react-virtual'

export function createCappedRangeExtractor(maxItems: number) {
  return function cappedRangeExtractor(range: Range): number[] {
    const defaultRange = defaultRangeExtractor(range)

    if (defaultRange.length <= maxItems) {
      return defaultRange
    }

    const visibleRange: number[] = []
    for (let i = range.startIndex; i <= range.endIndex; i += 1) {
      visibleRange.push(i)
    }

    if (visibleRange.length >= maxItems) {
      return visibleRange
    }

    const visibleSet = new Set(visibleRange)
    const overscanNeighbors: number[] = []
    for (const index of defaultRange) {
      if (!visibleSet.has(index)) {
        overscanNeighbors.push(index)
      }
    }

    const midpoint = (range.startIndex + range.endIndex) / 2
    overscanNeighbors.sort((a, b) => Math.abs(a - midpoint) - Math.abs(b - midpoint))

    const remaining = maxItems - visibleRange.length
    const trimmed = [...visibleRange, ...overscanNeighbors.slice(0, remaining)]
    return trimmed.sort((a, b) => a - b)
  }
}
