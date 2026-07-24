import { isRecord } from "@/src/shared/type-guards"
import type { SeriesMetadata } from "@/src/types/series-metadata"
import type {
  InitializeTabPayload,
  InitializeTabReadyPayload,
} from "@/src/types/state-action-tab-payloads"
import type { VolumeState } from "@/src/types/tab-state"

export interface RawSeriesChapter {
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

export interface ResolveInitializeTabPayloadInput {
  siteIntegrationId: string
  rawMangaId: string | null
  chapters: RawSeriesChapter[]
  volumes?: RawSeriesVolume[]
  seriesMetadata?: SeriesMetadata
  extractionError?: unknown
}

function normalizeRawChapter(value: unknown): RawSeriesChapter | null {
  if (!isRecord(value)) return null

  const url = typeof value.url === "string" ? value.url.trim() : ""
  const title = typeof value.title === "string" ? value.title.trim() : ""
  if (!url || !title) return null

  return {
    id:
      typeof value.id === "string" && value.id.trim()
        ? value.id.trim()
        : undefined,
    url,
    title,
    locked: value.locked === true,
    chapterLabel:
      typeof value.chapterLabel === "string" && value.chapterLabel.trim()
        ? value.chapterLabel.trim()
        : undefined,
    chapterNumber:
      typeof value.chapterNumber === "number" ? value.chapterNumber : undefined,
    volumeId:
      typeof value.volumeId === "string" && value.volumeId.trim()
        ? value.volumeId.trim()
        : undefined,
    volumeNumber:
      typeof value.volumeNumber === "number" ? value.volumeNumber : undefined,
    volumeLabel:
      typeof value.volumeLabel === "string" && value.volumeLabel.trim()
        ? value.volumeLabel.trim()
        : undefined,
    language:
      typeof value.language === "string" && value.language.trim()
        ? value.language.trim()
        : undefined,
  }
}

function normalizeRawVolume(value: unknown): RawSeriesVolume | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === "string" ? value.id.trim() : ""
  if (!id) return null

  return {
    id,
    title:
      typeof value.title === "string" && value.title.trim()
        ? value.title.trim()
        : undefined,
    label:
      typeof value.label === "string" && value.label.trim()
        ? value.label.trim()
        : undefined,
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

export function resolveInitializeTabPayload(
  input: ResolveInitializeTabPayloadInput
): InitializeTabPayload {
  const rawMangaId =
    typeof input.rawMangaId === "string" && input.rawMangaId.trim()
      ? input.rawMangaId.trim()
      : null

  if (!rawMangaId) return { context: "unsupported" }

  if (input.extractionError) {
    const errorMessage =
      input.extractionError instanceof Error
        ? input.extractionError.message
        : typeof input.extractionError === "string"
          ? input.extractionError
          : "Failed to extract series metadata"
    return {
      context: "error",
      error: errorMessage || "Failed to extract series metadata",
    }
  }

  const seriesTitle = input.seriesMetadata?.title?.trim() ?? ""
  if (!seriesTitle) {
    return { context: "error", error: "Failed to extract series metadata" }
  }

  if (input.chapters.some((chapter) => !chapter.id?.trim())) {
    return { context: "error", error: "Failed to extract stable chapter ids" }
  }

  const chapters = input.chapters as Array<RawSeriesChapter & { id: string }>
  const payload: InitializeTabReadyPayload = {
    context: "ready",
    siteIntegrationId: input.siteIntegrationId,
    mangaId: rawMangaId,
    seriesTitle,
    chapters: chapters.map((chapter) => ({
      id: chapter.id,
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
    metadata: input.seriesMetadata,
  }
  return payload
}
