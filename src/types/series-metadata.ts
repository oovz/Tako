/**
 * Series metadata for downloads
 */
export interface SeriesMetadata {
  title: string;
  author?: string;
  artist?: string;
  description?: string;
  genres?: string[];
  communityRating?: number;
  year?: number;
  coverUrl?: string;
  alternativeTitles?: string[];
  status?: string;
  language?: string;
  contentRating?: string;
  readingDirection?: string;
  publisher?: string;
  tags?: string[];
}
