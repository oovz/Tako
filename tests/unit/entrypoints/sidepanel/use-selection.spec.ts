import { describe, expect, it } from 'vitest'

import { __applySelectionToItemsForTests } from '@/entrypoints/sidepanel/hooks/useSelection'
import type { SidePanelChapter, Volume, VolumeOrChapter } from '@/entrypoints/sidepanel/types'

function makeChapter(partial: Partial<SidePanelChapter> & { id: string; url: string; title: string }): SidePanelChapter {
  return {
    id: partial.id,
    url: partial.url,
    title: partial.title,
    index: partial.index ?? 1,
    chapterLabel: partial.chapterLabel,
    chapterNumber: partial.chapterNumber,
    selected: partial.selected ?? false,
    status: partial.status ?? 'queued',
    locked: partial.locked,
    volumeNumber: partial.volumeNumber,
  }
}

function makeVolume(number: number, groupId: string, chapters: SidePanelChapter[]): Volume {
  return {
    number,
    title: `Volume ${number}`,
    chapters,
    collapsed: false,
    groupId,
  }
}

describe('useSelection helpers', () => {
  it('never marks locked chapters selected during select-all updates', () => {
    const items: VolumeOrChapter[] = [
      makeVolume(1, 'volume-1', [
        makeChapter({ id: 'locked-1', url: 'locked-1', title: 'Locked 1', locked: true, selected: true }),
        makeChapter({ id: 'open-1', url: 'open-1', title: 'Open 1', selected: false }),
      ]),
      {
        ...makeChapter({ id: 'locked-2', url: 'locked-2', title: 'Locked 2', locked: true, selected: true }),
        isStandalone: true,
      },
      {
        ...makeChapter({ id: 'open-2', url: 'open-2', title: 'Open 2', selected: false }),
        isStandalone: true,
      },
    ]

    const updated = __applySelectionToItemsForTests(items, new Set(['open-1', 'open-2']), true)

    const flattened = updated.flatMap((item) => ('chapters' in item ? item.chapters : [item]))
    const byUrl = new Map(flattened.map((chapter) => [chapter.url, chapter]))

    expect(byUrl.get('open-1')?.selected).toBe(true)
    expect(byUrl.get('open-2')?.selected).toBe(true)
    expect(byUrl.get('locked-1')?.selected).toBe(false)
    expect(byUrl.get('locked-2')?.selected).toBe(false)
  })

  it('only updates provided chapter urls and leaves other unlocked chapters unchanged', () => {
    const items: VolumeOrChapter[] = [
      makeVolume(2, 'volume-2', [
        makeChapter({ id: 'open-a', url: 'open-a', title: 'Open A', selected: false }),
        makeChapter({ id: 'open-b', url: 'open-b', title: 'Open B', selected: true }),
      ]),
    ]

    const updated = __applySelectionToItemsForTests(items, new Set(['open-a']), true)

    if (!('chapters' in updated[0])) {
      throw new Error('Expected a volume item')
    }

    expect(updated[0].chapters[0]?.selected).toBe(true)
    expect(updated[0].chapters[1]?.selected).toBe(true)
  })

  it('updates only the targeted chapter id when multiple chapters share the same url', () => {
    const sharedUrl = 'https://example.com/chapter/shared'
    const items: VolumeOrChapter[] = [
      makeVolume(3, 'volume-3', [
        makeChapter({ id: 'chapter-a', url: sharedUrl, title: 'Chapter A', selected: false }),
        makeChapter({ id: 'chapter-b', url: sharedUrl, title: 'Chapter B', selected: false }),
      ]),
    ]

    const updated = __applySelectionToItemsForTests(items, new Set(['chapter-b']), true)

    if (!('chapters' in updated[0])) {
      throw new Error('Expected a volume item')
    }

    expect(updated[0].chapters[0]?.selected).toBe(false)
    expect(updated[0].chapters[1]?.selected).toBe(true)
  })
})

