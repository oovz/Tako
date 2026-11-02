import { describe, expect, it } from "vitest"
import { applyDownloadedChapterMarkers } from "@/entrypoints/sidepanel/hooks/sidepanelSeriesContextHelpers"
import type { VolumeOrChapter } from "@/entrypoints/sidepanel/types"

describe("downloaded chapter markers", () => {
  it("marks exact chapter ids in standalone and volume rows", () => {
    const items: VolumeOrChapter[] = [
      {
        id: "standalone-1",
        title: "Standalone",
        index: 1,
        selected: false,
        url: "https://example.com/standalone-1",
        status: "queued",
        isStandalone: true,
      },
      {
        groupId: "volume-1",
        title: "Volume 1",
        collapsed: false,
        chapters: [
          {
            id: "chapter-1",
            title: "Chapter 1",
            index: 2,
            selected: false,
            url: "https://example.com/chapter-1",
            status: "queued",
          },
          {
            id: "chapter-2",
            title: "Chapter 2",
            index: 3,
            selected: false,
            url: "https://example.com/chapter-2",
            status: "queued",
          },
        ],
      },
    ]

    const marked = applyDownloadedChapterMarkers(
      items,
      new Map([
        ["standalone-1", { outputDestination: "downloads-api" as const }],
        [
          "chapter-2",
          { outputDestination: "fsa" as const, saveConfirmedAt: 42 },
        ],
      ])
    )

    expect(marked[0]).toMatchObject({
      id: "standalone-1",
      downloaded: true,
      outputDestination: "downloads-api",
    })
    expect(marked[1]).toMatchObject({
      chapters: [
        { id: "chapter-1", downloaded: false },
        {
          id: "chapter-2",
          downloaded: true,
          outputDestination: "fsa",
          saveConfirmedAt: 42,
        },
      ],
    })
  })
})
