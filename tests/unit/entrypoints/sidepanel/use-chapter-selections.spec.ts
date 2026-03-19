import { describe, expect, it } from 'vitest'

import {
  buildSeriesKey,
  clearSelectionsForSeries,
  getSelectionsForSeries,
  setSelectionsForSeries,
} from '@/entrypoints/sidepanel/hooks/useChapterSelections'

describe('useChapterSelections helpers', () => {
  it('builds stable series key from site and series ids', () => {
    expect(buildSeriesKey('mangadex', 'series-1')).toBe('mangadex#series-1')
    expect(buildSeriesKey(undefined, 'series-1')).toBeUndefined()
    expect(buildSeriesKey('mangadex', undefined)).toBeUndefined()
  })

  it('stores chapter selections per series independently', () => {
    let selections = {}
    selections = setSelectionsForSeries(selections, 'mangadex#series-1', ['a', 'b'])
    selections = setSelectionsForSeries(selections, 'mangadex#series-2', ['x'])

    expect(getSelectionsForSeries(selections, 'mangadex#series-1')).toEqual(['a', 'b'])
    expect(getSelectionsForSeries(selections, 'mangadex#series-2')).toEqual(['x'])
  })

  it('deduplicates and preserves insertion order for a series selection set', () => {
    const selections = setSelectionsForSeries({}, 'mangadex#series-1', ['a', 'b', 'a', 'c', 'b'])

    expect(getSelectionsForSeries(selections, 'mangadex#series-1')).toEqual(['a', 'b', 'c'])
  })

  it('clears series selections when requested', () => {
    const withSelection = setSelectionsForSeries({}, 'mangadex#series-1', ['a'])
    const cleared = clearSelectionsForSeries(withSelection, 'mangadex#series-1')

    expect(getSelectionsForSeries(cleared, 'mangadex#series-1')).toEqual([])
  })
})
