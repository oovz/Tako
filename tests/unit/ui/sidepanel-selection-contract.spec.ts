import { describe, expect, it } from 'vitest'

import {
  buildSeriesKey,
  getSelectionsForSeries,
  setSelectionsForSeries,
} from '@/entrypoints/sidepanel/hooks/useChapterSelections'

describe('side panel chapter selection helpers', () => {
  it('builds stable series keys from site and series identifiers', () => {
    expect(buildSeriesKey('mangadex', 'mangadex:abc')).toBe('mangadex#mangadex:abc')
    expect(buildSeriesKey(undefined, 'mangadex:abc')).toBeUndefined()
    expect(buildSeriesKey('mangadex', undefined)).toBeUndefined()
  })

  it('stores and retrieves normalized chapter selections inside parent-owned React state', () => {
    const seriesKey = 'mangadex::mangadex:abc'
    const selections = setSelectionsForSeries({}, seriesKey, [
      'https://example.com/chapter/1',
      'https://example.com/chapter/1',
      '  ',
      'https://example.com/chapter/2',
    ])

    expect(getSelectionsForSeries(selections, seriesKey)).toEqual([
      'https://example.com/chapter/1',
      '  ',
      'https://example.com/chapter/2',
    ])
  })
})
