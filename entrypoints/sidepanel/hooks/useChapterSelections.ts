import { useCallback, useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'

export type ChapterSelectionsBySeries = Record<string, string[]>

function normalizeSelections(chapterIds: string[]): string[] {
  const unique = new Set<string>()
  chapterIds.forEach((chapterId) => {
    if (typeof chapterId === 'string' && chapterId.length > 0) {
      unique.add(chapterId)
    }
  })
  return Array.from(unique)
}

function areEqualSelections(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false
    }
  }

  return true
}

export function buildSeriesKey(siteId: string | undefined, seriesId: string | undefined): string | undefined {
  if (!siteId || !seriesId) {
    return undefined
  }

  return `${siteId}#${seriesId}`
}

export function getSelectionsForSeries(
  chapterSelectionsBySeries: ChapterSelectionsBySeries,
  seriesKey: string | undefined,
): string[] {
  if (!seriesKey) {
    return []
  }

  return chapterSelectionsBySeries[seriesKey] ?? []
}

export function setSelectionsForSeries(
  chapterSelectionsBySeries: ChapterSelectionsBySeries,
  seriesKey: string | undefined,
  chapterIds: string[],
): ChapterSelectionsBySeries {
  if (!seriesKey) {
    return chapterSelectionsBySeries
  }

  const normalized = normalizeSelections(chapterIds)
  if (normalized.length === 0) {
    return clearSelectionsForSeries(chapterSelectionsBySeries, seriesKey)
  }

  const current = getSelectionsForSeries(chapterSelectionsBySeries, seriesKey)
  if (areEqualSelections(current, normalized)) {
    return chapterSelectionsBySeries
  }

  return {
    ...chapterSelectionsBySeries,
    [seriesKey]: normalized,
  }
}

export function clearSelectionsForSeries(
  chapterSelectionsBySeries: ChapterSelectionsBySeries,
  seriesKey: string | undefined,
): ChapterSelectionsBySeries {
  if (!seriesKey || !(seriesKey in chapterSelectionsBySeries)) {
    return chapterSelectionsBySeries
  }

  const nextSelections = { ...chapterSelectionsBySeries }
  delete nextSelections[seriesKey]
  return nextSelections
}

export function useChapterSelections(
  seriesKey: string | undefined,
  chapterSelectionsBySeries: ChapterSelectionsBySeries,
  setChapterSelectionsBySeries: Dispatch<SetStateAction<ChapterSelectionsBySeries>>,
) {
  const selectedChapterIds = useMemo(
    () => getSelectionsForSeries(chapterSelectionsBySeries, seriesKey),
    [chapterSelectionsBySeries, seriesKey],
  )

  const setSelectedChapterIds = useCallback((chapterIds: string[]) => {
    setChapterSelectionsBySeries((previousSelections) => setSelectionsForSeries(previousSelections, seriesKey, chapterIds))
  }, [seriesKey, setChapterSelectionsBySeries])

  const clearSeriesSelections = useCallback(() => {
    setChapterSelectionsBySeries((previousSelections) => clearSelectionsForSeries(previousSelections, seriesKey))
  }, [seriesKey, setChapterSelectionsBySeries])

  return {
    selectedChapterIds,
    setSelectedChapterIds,
    clearSeriesSelections,
  }
}
