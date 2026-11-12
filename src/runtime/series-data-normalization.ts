import { isRecord } from "@/src/shared/type-guards"
import {
  ChapterArchiveMetadataSchema,
  SeriesMetadataSchema,
} from "@/src/runtime/series-data-schemas"
import { pickChapterArchiveMetadata } from "@/src/shared/chapter-metadata"
import type { ChapterArchiveMetadata } from "@/src/types/chapter"
import type { SeriesMetadata } from "@/src/types/series-metadata"
import type {
  ResolvedTabContext,
  ResolvedTabReadyContext,
} from "@/src/types/resolved-tab-context"
import type { SeriesMetadataSnapshot } from "@/src/types/state-snapshots"
import type { VolumeState } from "@/src/types/tab-state"

export interface RawSeriesChapter extends ChapterArchiveMetadata {
  id?: string
  url: string
  title: string
  locked?: boolean
  chapterLabel?: string
  chapterNumber?: number
  volumeId?: string
  volumeNumber?: number
  volumeLabel?: string
  language?: string
}

export type RawSeriesVolume = VolumeState

export interface NormalizedSeriesData {
  chapters: RawSeriesChapter[]
  volumes: RawSeriesVolume[]
}

export interface BuildResolvedTabContextInput {
  sourceUrl: string
  siteIntegrationId: string
  rawMangaId: string | null
  chapters: RawSeriesChapter[]
  volumes?: RawSeriesVolume[]
  seriesMetadata?: SeriesMetadata
  extractionError?: unknown
  chaptersLoading?: boolean
  chapterListNotice?: "adult-consent-required"
}

type SeriesMetadataSnapshotInput = SeriesMetadataSnapshot &
  Partial<Pick<SeriesMetadata, "title">>

export function normalizeSeriesMetadataSnapshot(
  metadata: SeriesMetadataSnapshotInput | undefined
): SeriesMetadataSnapshot | undefined {
  if (!metadata) return undefined

  const snapshot = { ...metadata }
  delete snapshot.title
  return snapshot
}

function normalizedOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return value.trim() || undefined
}

function normalizedOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function normalizeRawChapter(value: unknown): RawSeriesChapter | null {
  if (!isRecord(value)) return null

  const url = typeof value.url === "string" ? value.url.trim() : ""
  const title = typeof value.title === "string" ? value.title.trim() : ""
  if (!url || !title) return null

  return {
    ...ChapterArchiveMetadataSchema.safeParse(value).data,
    id: normalizedOptionalString(value.id),
    url,
    title,
    locked: value.locked === true,
    chapterLabel: normalizedOptionalString(value.chapterLabel),
    chapterNumber: normalizedOptionalNumber(value.chapterNumber),
    volumeId: normalizedOptionalString(value.volumeId),
    volumeNumber: normalizedOptionalNumber(value.volumeNumber),
    volumeLabel: normalizedOptionalString(value.volumeLabel),
    language: normalizedOptionalString(value.language),
  }
}

function normalizeRawVolume(value: unknown): RawSeriesVolume | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === "string" ? value.id.trim() : ""
  if (!id) return null

  return {
    id,
    title: normalizedOptionalString(value.title),
    label: normalizedOptionalString(value.label),
    ...(value.isCategory === true ? { isCategory: true } : {}),
  }
}

export function normalizeFetchedSeriesData(
  result: unknown
): NormalizedSeriesData {
  const chapterValues = Array.isArray(result)
    ? result
    : isRecord(result) && Array.isArray(result.chapters)
      ? result.chapters
      : []
  const volumeValues =
    isRecord(result) && Array.isArray(result.volumes) ? result.volumes : []

  return {
    chapters: chapterValues
      .map(normalizeRawChapter)
      .filter((chapter): chapter is RawSeriesChapter => chapter !== null),
    volumes: volumeValues
      .map(normalizeRawVolume)
      .filter((volume): volume is RawSeriesVolume => volume !== null),
  }
}

function extractionErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === "string" ? error : "Failed to extract series metadata"
}

function resolveChapterIdentities(chapters: RawSeriesChapter[]):
  | { context: "error"; error: string }
  | {
      context: "ready"
      chapters: Array<RawSeriesChapter & { id: string }>
      chapterIds: string[]
    } {
  if (chapters.some((chapter) => !chapter.id?.trim())) {
    return { context: "error", error: "Failed to extract stable chapter ids" }
  }
  const identified = chapters as Array<RawSeriesChapter & { id: string }>
  const chapterIds = identified.map((chapter) => chapter.id.trim())
  if (new Set(chapterIds).size !== chapterIds.length) {
    return {
      context: "error",
      error: "Failed to extract unique stable chapter ids",
    }
  }
  return { context: "ready", chapters: identified, chapterIds }
}

export function buildResolvedTabContext(
  input: BuildResolvedTabContextInput
): ResolvedTabContext {
  const rawMangaId = normalizedOptionalString(input.rawMangaId)

  if (!rawMangaId) return { context: "unsupported" }

  const seriesMetadata = input.seriesMetadata
    ? SeriesMetadataSchema.parse(input.seriesMetadata)
    : undefined

  if (input.extractionError) {
    const errorMessage = extractionErrorMessage(input.extractionError)
    return {
      context: "error",
      error: errorMessage || "Failed to extract series metadata",
    }
  }

  return buildReadySeriesContext(input, rawMangaId, seriesMetadata)
}

function buildReadySeriesContext(
  input: BuildResolvedTabContextInput,
  mangaId: string,
  seriesMetadata: SeriesMetadata | undefined
): ResolvedTabContext {
  const seriesTitle = seriesMetadata?.title?.trim() ?? ""
  if (!seriesTitle) {
    return { context: "error", error: "Failed to extract series metadata" }
  }

  const identity = resolveChapterIdentities(input.chapters)
  if (identity.context === "error") return identity
  const chapters = identity.chapters
  const chapterIds = identity.chapterIds
  const payload: ResolvedTabReadyContext = {
    context: "ready",
    sourceUrl: input.sourceUrl,
    siteIntegrationId: input.siteIntegrationId,
    mangaId,
    seriesTitle,
    chapters: chapters.map((chapter, index) => ({
      ...pickChapterArchiveMetadata(chapter),
      id: chapterIds[index],
      url: chapter.url,
      title: chapter.title,
      locked: chapter.locked === true,
      chapterLabel: chapter.chapterLabel,
      chapterNumber: chapter.chapterNumber,
      volumeId: chapter.volumeId,
      volumeNumber: chapter.volumeNumber,
      volumeLabel: chapter.volumeLabel,
      language: chapter.language,
    })),
    volumes: input.volumes,
    metadata: normalizeSeriesMetadataSnapshot(seriesMetadata),
    chaptersLoading: input.chaptersLoading,
    chapterListNotice: input.chapterListNotice,
  }
  return payload
}
