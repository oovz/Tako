import { afterEach, describe, expect, it, vi } from "vitest"
import { rebuildSeriesHistory } from "@/src/domain/history/cleanup-policy"
import type { DownloadedChapterRecord } from "@/src/domain/history/types"
import { parseHistoryAggregate } from "@/src/runtime/state-schema-migration-history-schema"
import { parseEpoch5NativeOutputState } from "@/src/runtime/state-schema-migration-native-schema"
import { migrateDurableStateForCurrentSchema } from "@/src/runtime/state-schema-migration"

const record: DownloadedChapterRecord = {
  siteIntegrationId: "mangadex",
  chapterId: "chapter",
  seriesId: "series",
  url: "https://mangadex.org/chapter/chapter",
  title: "Chapter",
  seriesTitle: "Series",
  downloadedAt: 10,
  format: "cbz",
}

function history(records = [record]) {
  return {
    downloadedChapters: records,
    seriesDownloadHistory: rebuildSeriesHistory(records),
    clearCutoffs: { bySeries: {}, byChapter: {} },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe("historical history aggregate validation", () => {
  it("accepts a complete aggregate and rejects duplicate chapter identities", () => {
    expect(parseHistoryAggregate(history())).toEqual(history())
    expect(() =>
      parseHistoryAggregate(history([record, { ...record, downloadedAt: 20 }]))
    ).toThrow()
  })

  it.each([
    { ...history(), seriesDownloadHistory: {} },
    {
      ...history(),
      seriesDownloadHistory: {
        "mangadex#series": {
          ...history().seriesDownloadHistory["mangadex#series"],
          seriesTitle: "Another series",
        },
      },
    },
    { ...history(), downloadedChapters: [{ ...record, downloadedAt: -1 }] },
    { ...history(), seriesDownloadHistory: null },
    {
      ...history(),
      clearCutoffs: { bySeries: {}, byChapter: { chapter: -1 } },
    },
    { downloadedChapters: [record] },
  ])("rejects inconsistent or malformed retained aggregates %#", (raw) => {
    expect(() => parseHistoryAggregate(raw)).toThrow()
  })
})

function nativeState(phase: string, extra: Record<string, unknown> = {}) {
  const identity = {
    jobId: "job",
    taskId: "task",
    chapterId: "chapter",
    attempt: 1,
    fingerprint: "a".repeat(64),
    documentInstanceId: "document",
  }
  return {
    manifestsByJobId: {
      job: {
        ...identity,
        phase: "sealed",
        outputsRequested: 1,
        outputsFailedBeforeHandoff: 0,
        slots: [{ disposition: "tracked", outputId: "output" }],
        createdAt: 1,
        sealedAt: 4,
      },
    },
    outputsByOutputId: {
      output: {
        ...identity,
        outputId: "output",
        outputIndex: 0,
        outputCount: 1,
        blobUrl: "blob:output",
        filename: "Series/Chapter.cbz",
        outputKind: "archive",
        phase,
        createdAt: 1,
        accountingDisposition: "accounted",
        accountingDispositionAt: 4,
        ...extra,
      },
    },
  }
}

describe("retained native accounting evidence", () => {
  it("rejects resolved accounting before handoff and accepts its recorded interruption outcomes", () => {
    expect(() =>
      parseEpoch5NativeOutputState(nativeState("prepared"))
    ).toThrow()
    expect(() =>
      parseEpoch5NativeOutputState(
        nativeState("acceptance_unknown", { acceptanceStartedAt: 2 })
      )
    ).toThrow()
    expect(
      parseEpoch5NativeOutputState(
        nativeState("handoff_interrupted", { acceptanceStartedAt: 2 })
      ).outputsByOutputId.output.phase
    ).toBe("handoff_interrupted")
    expect(
      parseEpoch5NativeOutputState(
        nativeState("interrupted", { terminalAt: 4 })
      ).outputsByOutputId.output.phase
    ).toBe("interrupted")
  })
})

describe("legacy chapter memory import", () => {
  it.each([
    ["https://sub.manhuagui.com./chapter/1", "readmanga"],
    ["https://comic.pixiv.net/chapter/1", "pixiv-comic"],
    ["https://unrecognized.example/chapter/1", "legacy:unrecognized.example"],
    ["not a URL", "legacy-unresolved"],
    ["file:///chapter/1", "legacy:unresolved"],
  ])(
    "retains %s under its resolved history identity",
    async (url, siteIntegrationId) => {
      const legacyRecord: Partial<DownloadedChapterRecord> = { ...record }
      delete legacyRecord.siteIntegrationId
      const local: Record<string, unknown> = {
        downloadedChapters: [{ ...legacyRecord, url }],
      }
      vi.stubGlobal("chrome", {
        storage: {
          local: {
            get: vi.fn(async (keys: string[]) =>
              Object.fromEntries(
                keys
                  .filter((key) => key in local)
                  .map((key) => [key, structuredClone(local[key])])
              )
            ),
            set: vi.fn(async (writes: Record<string, unknown>) => {
              Object.assign(local, structuredClone(writes))
            }),
            remove: vi.fn(async (keys: string | string[]) => {
              for (const key of [keys].flat()) delete local[key]
            }),
          },
        },
      })
      await migrateDurableStateForCurrentSchema()
      expect(local.downloadedChapters).toMatchObject([
        { chapterId: "chapter", url, siteIntegrationId, downloadedAt: 10 },
      ])
    }
  )
})

function storedProfile(initial: Record<string, unknown>) {
  const local = structuredClone(initial)
  const storage = {
    get: vi.fn(async (keys: string[]) =>
      Object.fromEntries(
        keys
          .filter((key) => key in local)
          .map((key) => [key, structuredClone(local[key])])
      )
    ),
    set: vi.fn(async (writes: Record<string, unknown>) => {
      Object.assign(local, structuredClone(writes))
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of [keys].flat()) delete local[key]
    }),
  }
  vi.stubGlobal("chrome", { storage: { local: storage } })
  return { local, storage }
}

describe("legacy series-history import", () => {
  it.each(["pixiv-comic", undefined])(
    "uses the series identity %s and retains the newest chapter record",
    async (fallback) => {
      const legacy: Partial<DownloadedChapterRecord> = { ...record }
      delete legacy.siteIntegrationId
      const url = "https://comic.pixiv.net/chapter/1"
      const { local } = storedProfile({
        seriesDownloadHistory: {
          retained: {
            siteIntegrationId: fallback,
            downloadedChapters: [
              { ...legacy, url },
              { ...legacy, url, downloadedAt: 20 },
            ],
          },
        },
      })
      await migrateDurableStateForCurrentSchema()
      expect(local.downloadedChapters).toEqual([
        { ...record, siteIntegrationId: "pixiv-comic", url, downloadedAt: 20 },
      ])
    }
  )

  it.each([
    { downloadedChapters: null },
    { seriesDownloadHistory: null },
    { seriesDownloadHistory: { retained: null } },
    { seriesDownloadHistory: { retained: { downloadedChapters: "invalid" } } },
  ])(
    "preserves a malformed legacy history profile before writing %#",
    async (initial) => {
      const { local, storage } = storedProfile(initial)
      await expect(migrateDurableStateForCurrentSchema()).rejects.toThrow()
      expect(local).toEqual(initial)
      expect(storage.set).not.toHaveBeenCalled()
      expect(storage.remove).not.toHaveBeenCalled()
    }
  )
})
