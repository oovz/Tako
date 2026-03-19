import type { Book } from '@/src/types/book';
import type { ChapterInput, Chapter } from '@/src/types/chapter';
import type { ComicInfoV2 } from '@/src/types/comic-info';
import type { SeriesMetadata } from '@/src/types/series-metadata';

type SeriesMetadataLike = Pick<
  SeriesMetadata,
  'author' | 'artist' | 'description' | 'genres' | 'communityRating' | 'year' | 'language' | 'contentRating' | 'readingDirection' | 'publisher'
>;

function mapContentRatingToAgeRating(contentRating: string | undefined): ComicInfoV2['AgeRating'] | undefined {
  switch (contentRating) {
    case 'safe':
      return 'Everyone';
    case 'suggestive':
      return 'Teen';
    case 'erotica':
      return 'Mature 17+';
    case 'pornographic':
      return 'Adults Only 18+';
    default:
      return undefined;
  }
}

function mapReadingDirectionToManga(readingDirection: string | undefined): ComicInfoV2['Manga'] | undefined {
  if (!readingDirection) {
    return undefined;
  }

  const normalized = readingDirection.trim().toLowerCase();
  if (normalized === 'rtl' || normalized === 'right-to-left' || normalized === 'right_to_left') {
    return 'YesAndRightToLeft';
  }

  if (normalized === 'ltr' || normalized === 'left-to-right' || normalized === 'left_to_right') {
    return 'Yes';
  }

  return undefined;
}

export function buildSeriesComicInfoBase(seriesTitle: string, metadata?: SeriesMetadataLike): ComicInfoV2 {
  const base: ComicInfoV2 = {
    Series: seriesTitle,
    Writer: metadata?.author,
    Penciller: metadata?.artist,
    Summary: metadata?.description,
    Genre: Array.isArray(metadata?.genres) && metadata.genres.length > 0 ? metadata.genres.join(', ') : undefined,
    CommunityRating: typeof metadata?.communityRating === 'number' ? metadata.communityRating : undefined,
    Year: metadata?.year,
    LanguageISO: metadata?.language,
    AgeRating: mapContentRatingToAgeRating(metadata?.contentRating),
    Manga: mapReadingDirectionToManga(metadata?.readingDirection) ?? 'Yes',
    Publisher: metadata?.publisher,
    Format: 'Web',
  };

  return base;
}

// Compose chapter ComicInfo by merging book base + chapter specifics. No PageCount here.
export function composeChapterMetadata(book: Book, input: ChapterInput): Chapter {
  // Start with shallow clone of base to avoid mutation
  const base: ComicInfoV2 = { ...(book.comicInfoBase || {}) };

  // Title: prefer chapter title; keep Series from base
  base.Title = input.title || base.Title || book.seriesTitle;
  base.Series = base.Series || book.seriesTitle;

  // Chapter number normalization: prefer raw string, else parsed numeric
  if (input.chapterLabel) {
    base.Number = input.chapterLabel.trim();
  } else if (typeof input.chapterNumber === 'number') {
    // Avoid losing decimal semantics; store as plain string
    base.Number = String(input.chapterNumber);
  }

  if (typeof input.volumeNumber === 'number') {
    base.Volume = input.volumeNumber;
  }

  if (input.language) {
    base.LanguageISO = input.language;
  }

  return {
    id: input.id,
    url: input.url,
    title: input.title,
    language: input.language,
    chapterLabel: input.chapterLabel || base.Number,
    chapterNumber: input.chapterNumber,
    volumeNumber: input.volumeNumber,
    volumeLabel: input.volumeLabel,
    comicInfo: base
  };
}
