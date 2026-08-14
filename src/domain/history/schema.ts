import { z } from "zod"

import {
  composeDownloadedChapterKey,
  type DownloadHistoryClearCutoffs,
  type DownloadedChapterRecord,
  type HistoryAggregate,
  type SeriesDownloadHistory,
} from "./types"
import { rebuildSeriesHistory } from "./cleanup-policy"

const DownloadedChapterRecordSchema = z.strictObject({
  siteIntegrationId: z.string().min(1),
  chapterId: z.string().min(1),
  url: z.string(),
  title: z.string(),
  seriesId: z.string().min(1),
  seriesTitle: z.string(),
  chapterNumber: z.number().finite().optional(),
  volumeNumber: z.number().finite().optional(),
  downloadedAt: z.number().finite().nonnegative(),
  filePath: z.string().optional(),
  fileSize: z.number().finite().nonnegative().optional(),
  format: z.enum(["zip", "cbz", "cbr", "pdf", "none"]),
})

const SeriesDownloadHistorySchema = z.strictObject({
  siteIntegrationId: z.string().min(1),
  seriesId: z.string().min(1),
  seriesTitle: z.string(),
  lastUpdated: z.number().finite().nonnegative(),
  downloadedChapters: z.array(DownloadedChapterRecordSchema),
})

const SeriesDownloadHistoryMapSchema = z.record(
  z.string().min(1),
  SeriesDownloadHistorySchema
)

const DownloadHistoryClearCutoffsSchema = z.strictObject({
  allBefore: z.number().finite().nonnegative().optional(),
  bySeries: z.record(z.string().min(1), z.number().finite().nonnegative()),
  byChapter: z.record(z.string().min(1), z.number().finite().nonnegative()),
})

export class HistoryDocumentError extends Error {
  constructor(message: string) {
    super(`Stored download history is invalid: ${message}`)
    this.name = "HistoryDocumentError"
  }
}

function parseRecords(raw: unknown): DownloadedChapterRecord[] {
  const parsed = z.array(DownloadedChapterRecordSchema).safeParse(raw)
  if (!parsed.success) throw new HistoryDocumentError("downloaded chapters")
  return parsed.data
}

function parseHistoryMap(raw: unknown): Record<string, SeriesDownloadHistory> {
  const parsed = SeriesDownloadHistoryMapSchema.safeParse(raw)
  if (!parsed.success) throw new HistoryDocumentError("series history")
  return parsed.data
}

function parseCutoffs(raw: unknown): DownloadHistoryClearCutoffs {
  const parsed = DownloadHistoryClearCutoffsSchema.safeParse(raw)
  if (!parsed.success) throw new HistoryDocumentError("clear cutoffs")
  return parsed.data
}

function validateInvariants(aggregate: HistoryAggregate): void {
  const chapterKeys = new Set<string>()
  for (const chapter of aggregate.downloadedChapters) {
    const key = composeDownloadedChapterKey(
      chapter.siteIntegrationId,
      chapter.seriesId,
      chapter.chapterId
    )
    if (chapterKeys.has(key))
      throw new HistoryDocumentError("duplicate chapter")
    chapterKeys.add(key)
  }

  const expectedHistory = rebuildSeriesHistory(aggregate.downloadedChapters)
  const actualKeys = Object.keys(aggregate.seriesDownloadHistory).sort()
  const expectedKeys = Object.keys(expectedHistory).sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new HistoryDocumentError("series history keys")
  }
  for (const key of expectedKeys) {
    if (
      JSON.stringify(aggregate.seriesDownloadHistory[key]) !==
      JSON.stringify(expectedHistory[key])
    ) {
      throw new HistoryDocumentError("series history divergence")
    }
  }
}

export function parseHistoryAggregate(
  raw: Record<string, unknown>
): HistoryAggregate {
  const present = [
    "downloadedChapters",
    "seriesDownloadHistory",
    "clearCutoffs",
  ].filter((key) => key in raw)
  if (present.length === 0) {
    return {
      downloadedChapters: [],
      seriesDownloadHistory: {},
      clearCutoffs: { bySeries: {}, byChapter: {} },
    }
  }
  if (present.length !== 3) {
    throw new HistoryDocumentError("partial aggregate")
  }

  const aggregate: HistoryAggregate = {
    downloadedChapters: parseRecords(raw.downloadedChapters),
    seriesDownloadHistory: parseHistoryMap(raw.seriesDownloadHistory),
    clearCutoffs: parseCutoffs(raw.clearCutoffs),
  }
  validateInvariants(aggregate)
  return aggregate
}

export function cloneHistoryAggregate(
  aggregate: HistoryAggregate
): HistoryAggregate {
  return structuredClone(aggregate)
}

export function serializeHistoryAggregate(
  aggregate: HistoryAggregate
): Record<string, unknown> {
  return {
    downloadedChapters: aggregate.downloadedChapters,
    seriesDownloadHistory: aggregate.seriesDownloadHistory,
    clearCutoffs: aggregate.clearCutoffs,
  }
}

export { DownloadedChapterRecordSchema, SeriesDownloadHistorySchema }
