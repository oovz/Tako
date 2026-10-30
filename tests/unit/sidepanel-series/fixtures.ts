import type { SidepanelSeriesContextData } from "@/entrypoints/sidepanel/hooks/useSidepanelSeriesContext"
import type { SidePanelChapter } from "@/entrypoints/sidepanel/types"
import type { ChapterState } from "@/src/types/tab-state"

export function chapter(
  id: string,
  overrides: Partial<SidePanelChapter> = {}
): SidePanelChapter & ChapterState {
  return {
    id,
    title: `Chapter ${id}`,
    url: `https://mangadex.org/chapter/${id}`,
    index: 1,
    selected: false,
    status: "queued",
    lastUpdated: 1,
    ...overrides,
  }
}

export function series(
  overrides: Partial<SidepanelSeriesContextData> = {}
): SidepanelSeriesContextData {
  return {
    windowId: 3,
    tabId: 7,
    seriesRevision: 2,
    mangaTitle: "Series One",
    seriesId: "one",
    siteId: "mangadex",
    items: [
      {
        groupId: "volume-1",
        title: "Volume 1",
        collapsed: false,
        chapters: [chapter("one"), chapter("locked", { locked: true })],
      },
      { ...chapter("extra"), isStandalone: true },
    ],
    mangaState: {
      sourceUrl: "https://mangadex.org/title/one",
      siteIntegrationId: "mangadex",
      mangaId: "one",
      seriesTitle: "Series One",
      chapters: [
        chapter("one"),
        chapter("locked", { locked: true }),
        chapter("extra"),
      ],
      volumes: [],
      lastUpdated: 1,
    },
    isLoading: false,
    isChaptersLoading: false,
    blockingMessage: undefined,
    ...overrides,
  }
}
