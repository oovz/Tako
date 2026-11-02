import { describe, expect, it } from "vitest"

import {
  cleanupOlderThan,
  rebuildSeriesHistory,
} from "@/src/domain/history/cleanup-policy"
import {
  composeDownloadedChapterKey,
  type DownloadedChapterRecord,
  type HistoryAggregate,
} from "@/src/domain/history/types"

const day = 24 * 60 * 60 * 1000

function record(
  chapterId: string,
  downloadedAt: number
): DownloadedChapterRecord {
  return {
    siteIntegrationId: "mangadex",
    seriesId: "series",
    seriesTitle: "Series",
    chapterId,
    title: `Chapter ${chapterId}`,
    url: `https://example.com/${chapterId}`,
    format: "cbz",
    downloadedAt,
  }
}

describe("chapter history retention", () => {
  it("removes records at the cutoff and records clear evidence while rebuilding surviving series", () => {
    const records = [
      record("old", day),
      record("boundary", 2 * day),
      record("fresh", 2 * day + 1),
    ]
    const initial: HistoryAggregate = {
      downloadedChapters: records,
      seriesDownloadHistory: rebuildSeriesHistory(records),
      clearCutoffs: {
        allBefore: 10,
        bySeries: { previous: 20 },
        byChapter: { previous: 30 },
      },
    }
    const before = structuredClone(initial)
    const next = cleanupOlderThan(initial, 1, 3 * day)
    expect(next.downloadedChapters.map((chapter) => chapter.chapterId)).toEqual(
      ["fresh"]
    )
    expect(
      next.seriesDownloadHistory["mangadex#series"]?.downloadedChapters
    ).toEqual([records[2]])
    expect(next.clearCutoffs).toEqual({
      allBefore: 10,
      bySeries: { previous: 20 },
      byChapter: {
        previous: 30,
        [composeDownloadedChapterKey("mangadex", "series", "old")]: 3 * day,
        [composeDownloadedChapterKey("mangadex", "series", "boundary")]:
          3 * day,
      },
    })
    expect(initial).toEqual(before)
  })

  it("removes an exhausted series without sharing mutable clear markers", () => {
    const records = [record("old", day)]
    const initial: HistoryAggregate = {
      downloadedChapters: records,
      seriesDownloadHistory: rebuildSeriesHistory(records),
      clearCutoffs: { bySeries: {}, byChapter: {} },
    }
    const next = cleanupOlderThan(initial, 1, 3 * day)
    expect(next.downloadedChapters).toEqual([])
    expect(next.seriesDownloadHistory).toEqual({})
    expect(initial.clearCutoffs.byChapter).toEqual({})
  })
})
