/**
 * Guards the Side Panel virtualizer DOM budget. The extractor trims overscan
 * rows when possible, but it must never omit rows that TanStack Virtual marks
 * as viewport-visible.
 */
import { describe, expect, it } from 'vitest'
import { defaultRangeExtractor, type Range } from '@tanstack/react-virtual'
import { createCappedRangeExtractor } from '@/src/ui/shared/virtualization/cap-range-extractor'

function range(over: Partial<Range> = {}): Range {
  return {
    startIndex: 0,
    endIndex: 9,
    overscan: 2,
    count: 100,
    ...over,
  }
}

describe('createCappedRangeExtractor', () => {
  it('returns the default range when it is within the cap', () => {
    const extractor = createCappedRangeExtractor(20)
    const r = range({ startIndex: 5, endIndex: 10, overscan: 2, count: 100 })
    expect(extractor(r)).toEqual(defaultRangeExtractor(r))
  })

  it('trims overscan first, keeping the visible range intact', () => {
    const extractor = createCappedRangeExtractor(6)
    // Visible range = 5..10 (6 items); overscan would add 4 more (3,4,11,12).
    const r = range({ startIndex: 5, endIndex: 10, overscan: 2, count: 100 })
    const result = extractor(r)

    expect(result.length).toBe(6)
    // All visible indices must be retained.
    for (let i = 5; i <= 10; i += 1) {
      expect(result).toContain(i)
    }
    // Result must be ascending (required by the virtualizer layout).
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i]).toBeGreaterThan(result[i - 1])
    }
  })

  it('keeps every visible index when the visible range itself exceeds the cap', () => {
    const extractor = createCappedRangeExtractor(4)
    // Visible range = 10..30 (21 items), which is already over the target cap.
    const r = range({ startIndex: 10, endIndex: 30, overscan: 0, count: 100 })
    const result = extractor(r)

    expect(result.length).toBe(21)
    for (let i = 10; i <= 30; i += 1) {
      expect(result).toContain(i)
    }
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i]).toBeGreaterThan(result[i - 1])
    }
  })

  it('drops overscan but not visible rows when a tall queue viewport exceeds the target cap', () => {
    const extractor = createCappedRangeExtractor(18) // queue cap
    // Simulate a very tall panel: visible range 0..30 (31 items) + overscan 4.
    const r = range({ startIndex: 0, endIndex: 30, overscan: 4, count: 1000 })
    const result = extractor(r)
    expect(result.length).toBe(31)
    for (let i = 0; i <= 30; i += 1) {
      expect(result).toContain(i)
    }
  })

  it('drops overscan but not visible rows when a tall chapter viewport exceeds the target cap', () => {
    const extractor = createCappedRangeExtractor(28) // chapter cap
    // Simulate a very tall panel: visible range 0..40 (41 items) + overscan 6.
    const r = range({ startIndex: 0, endIndex: 40, overscan: 6, count: 1000 })
    const result = extractor(r)
    expect(result.length).toBe(41)
    for (let i = 0; i <= 40; i += 1) {
      expect(result).toContain(i)
    }
  })

  it('handles edge case where count is smaller than the cap', () => {
    const extractor = createCappedRangeExtractor(28)
    const r = range({ startIndex: 0, endIndex: 4, overscan: 6, count: 5 })
    // Default extractor clamps to count; result must be <= count and <= cap.
    const result = extractor(r)
    expect(result.length).toBeLessThanOrEqual(5)
    expect(result.every((i) => i >= 0 && i < 5)).toBe(true)
  })
})
