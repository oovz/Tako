import type { Book } from "@/src/types/book"
import type {
  ChapterArchiveMetadata,
  ChapterInput,
  Chapter,
} from "@/src/types/chapter"
import type { ComicInfoV2 } from "@/src/types/comic-info"
import type { SeriesMetadata } from "@/src/types/series-metadata"

type SeriesMetadataLike = Pick<
  SeriesMetadata,
  | "author"
  | "artist"
  | "description"
  | "genres"
  | "communityRating"
  | "chapterCount"
  | "year"
  | "language"
  | "contentRating"
  | "readingDirection"
  | "publisher"
  | "imprint"
>

const AGE_RATINGS = new Map<string, ComicInfoV2["AgeRating"]>([
  ["all ages", "Everyone"],
  ["adult", "Adults Only 18+"],
  ["teen", "Teen"],
  ["safe", "Everyone"],
  ["suggestive", "Teen"],
  ["erotica", "Mature 17+"],
  ["pornographic", "Adults Only 18+"],
])

const READING_DIRECTIONS = new Map<string, ComicInfoV2["Manga"]>([
  ["rtl", "YesAndRightToLeft"],
  ["right-to-left", "YesAndRightToLeft"],
  ["right_to_left", "YesAndRightToLeft"],
  ["ltr", "Yes"],
  ["left-to-right", "Yes"],
  ["left_to_right", "Yes"],
  ["vertical", "Yes"],
])

export function mapReadingDirectionToManga(
  readingDirection: string | undefined
): ComicInfoV2["Manga"] | undefined {
  return READING_DIRECTIONS.get(readingDirection?.trim().toLowerCase() ?? "")
}

export function pickChapterArchiveMetadata(
  chapter: ChapterArchiveMetadata
): ChapterArchiveMetadata {
  const { releaseDate, scanInformation, blackAndWhite, readingDirection } =
    chapter
  return {
    ...(releaseDate !== undefined ? { releaseDate } : {}),
    ...(scanInformation !== undefined ? { scanInformation } : {}),
    ...(blackAndWhite !== undefined ? { blackAndWhite } : {}),
    ...(readingDirection !== undefined ? { readingDirection } : {}),
  }
}

export function buildSeriesComicInfoBase(
  seriesTitle: string,
  metadata?: SeriesMetadataLike
): ComicInfoV2 {
  const source: Partial<SeriesMetadataLike> = metadata ?? {}
  const base: ComicInfoV2 = {
    Series: seriesTitle,
    Count: source.chapterCount,
    Writer: source.author,
    Penciller: source.artist,
    Summary: source.description,
    Genre:
      Array.isArray(source.genres) && source.genres.length > 0
        ? source.genres.join(", ")
        : undefined,
    CommunityRating:
      typeof source.communityRating === "number"
        ? source.communityRating
        : undefined,
    Year: source.year,
    LanguageISO: source.language,
    AgeRating: AGE_RATINGS.get(source.contentRating ?? ""),
    Manga: mapReadingDirectionToManga(source.readingDirection) ?? "Yes",
    Publisher: source.publisher,
    Imprint: source.imprint,
    Format: "Web",
  }

  return base
}

// Compose chapter ComicInfo by merging book base + chapter specifics. No PageCount here.
export function composeChapterMetadata(
  book: Book,
  input: ChapterInput
): Chapter {
  // Start with shallow clone of base to avoid mutation
  const base: ComicInfoV2 = { ...(book.comicInfoBase || {}) }

  // Title: prefer chapter title; keep Series from base
  base.Title = input.title || base.Title || book.seriesTitle
  base.Series = base.Series || book.seriesTitle

  applyChapterNumber(base, input)

  if (typeof input.volumeNumber === "number") {
    base.Volume = input.volumeNumber
  }

  if (input.language) {
    base.LanguageISO = input.language
  }

  return {
    ...pickChapterArchiveMetadata(input),
    id: input.id,
    url: input.url,
    title: input.title,
    language: input.language,
    chapterLabel: input.chapterLabel || base.Number,
    chapterNumber: input.chapterNumber,
    volumeId: input.volumeId,
    volumeNumber: input.volumeNumber,
    volumeLabel: input.volumeLabel,
    comicInfo: base,
  }
}

function applyChapterNumber(base: ComicInfoV2, input: ChapterInput): void {
  if (input.chapterLabel) {
    base.Number = input.chapterLabel.trim()
  } else if (typeof input.chapterNumber === "number") {
    // Keep decimal labels as plain strings in ComicInfo.
    base.Number = String(input.chapterNumber)
  }
}
