import { describe, expect, it } from 'vitest'

import type { SidePanelChapter, StandaloneChapter, Volume, VolumeOrChapter } from '@/entrypoints/sidepanel/types'
import {
  getInlineSelectionViewSummary,
  syncInlineSelectionItems,
} from '@/entrypoints/sidepanel/components/series-inline-selection-helpers'

function makeChapter(
  partial: Partial<SidePanelChapter> & { id: string; title: string; url: string },
): SidePanelChapter {
  return {
    id: partial.id,
    title: partial.title,
    url: partial.url,
    index: partial.index ?? 1,
    selected: partial.selected ?? false,
    status: partial.status ?? 'queued',
    locked: partial.locked,
    chapterLabel: partial.chapterLabel,
    chapterNumber: partial.chapterNumber,
    volumeNumber: partial.volumeNumber,
  }
}

function makeStandaloneChapter(
  partial: Partial<StandaloneChapter> & { id: string; title: string; url: string },
): StandaloneChapter {
  return {
    ...makeChapter(partial),
    isStandalone: true,
  }
}

function makeVolume(number: number, groupId: string, chapters: SidePanelChapter[]): Volume {
  return {
    number,
    title: `Volume ${number}`,
    groupId,
    collapsed: false,
    chapters,
  }
}

describe('series inline selection helpers', () => {
  it('preserves existing collapsed groups and expands newly added groups when syncing items', () => {
    const previousItems: Volume[] = [
      makeVolume(1, 'volume-1', [
        makeChapter({ id: 'v1-c1', title: 'Volume 1 Chapter 1', url: 'https://example.com/v1-c1' }),
      ]),
      makeVolume(9, 'stale-volume', [
        makeChapter({ id: 'stale-c1', title: 'Stale Chapter', url: 'https://example.com/stale-c1' }),
      ]),
    ]

    previousItems[0].collapsed = true
    previousItems[1].collapsed = false

    const items: Volume[] = [
      makeVolume(1, 'volume-1', [
        makeChapter({ id: 'v1-c1', title: 'Volume 1 Chapter 1', url: 'https://example.com/v1-c1' }),
      ]),
      makeVolume(2, 'volume-2', [
        makeChapter({ id: 'v2-c1', title: 'Volume 2 Chapter 1', url: 'https://example.com/v2-c1' }),
      ]),
    ]

    const syncedItems = syncInlineSelectionItems(items, ['v1-c1'], previousItems)

    const firstItem = syncedItems[0]
    const secondItem = syncedItems[1]

    expect('chapters' in firstItem).toBe(true)
    expect('chapters' in secondItem).toBe(true)

    if (!('chapters' in firstItem) || !('chapters' in secondItem)) {
      throw new Error('Expected synced items to preserve volume groups')
    }

    expect(firstItem.collapsed).toBe(true)
    expect(firstItem.chapters[0]?.selected).toBe(true)
    expect(secondItem.collapsed).toBe(false)
    expect(secondItem.chapters[0]?.selected).toBe(false)
  })

  it('summarizes grouped and standalone chapters for the selector toolbar', () => {
    const items: VolumeOrChapter[] = [
      makeStandaloneChapter({
        id: 'standalone-1',
        title: 'Standalone Chapter',
        url: 'https://example.com/standalone-1',
      }),
      makeVolume(1, 'volume-1', [
        makeChapter({ id: 'v1-c1', title: 'Volume 1 Chapter 1', url: 'https://example.com/v1-c1' }),
        makeChapter({ id: 'v1-c2', title: 'Volume 1 Chapter 2', url: 'https://example.com/v1-c2' }),
      ]),
      makeVolume(2, 'volume-2', [
        makeChapter({ id: 'v2-c1', title: 'Volume 2 Chapter 1', url: 'https://example.com/v2-c1' }),
      ]),
    ]

    expect(getInlineSelectionViewSummary(items)).toEqual({
      chapterCount: 4,
      volumeCount: 2,
      canToggleView: true,
    })
  })
})
