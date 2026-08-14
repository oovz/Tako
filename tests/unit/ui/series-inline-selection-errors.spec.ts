import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/entrypoints/sidepanel/hooks/useDownload", () => ({
  useDownload: () => ({
    startDownload: vi.fn(),
    showSuccess: false,
    isEnqueuing: false,
    errorMessage: "Unable to enqueue this download.",
  }),
}))

import { SeriesInlineSelection } from "@/entrypoints/sidepanel/components/SeriesInlineSelection"

describe("SeriesInlineSelection enqueue errors", () => {
  it("renders the enqueue failure inline without collapsing the selector", () => {
    const html = renderToStaticMarkup(
      React.createElement(SeriesInlineSelection, {
        data: {
          windowId: 3,
          tabId: 7,
          seriesRevision: 1,
          mangaState: {
            sourceUrl: "https://mangadex.org/title/series-1",
            siteIntegrationId: "mangadex",
            mangaId: "series-1",
            seriesTitle: "Series 1",
            chapters: [],
            volumes: [],
            lastUpdated: 1,
          },
          items: [],
          mangaTitle: "Series 1",
          seriesId: "series-1",
          isLoading: false,
          isChaptersLoading: false,
          blockingMessage: undefined,
          siteId: "mangadex",
        },
        chapterSelectionsBySeries: {},
        setChapterSelectionsBySeries: vi.fn(),
        presentationBySeries: {},
        setPresentationBySeries: vi.fn(),
      })
    )

    expect(html).toContain('role="alert"')
    expect(html).toContain("Unable to enqueue this download.")
  })
})
