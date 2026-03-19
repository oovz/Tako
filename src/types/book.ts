import type { ComicInfoV2 } from './comic-info';

/**
 * Book-level metadata shared by all chapters in a download task.
 * Only fields that are stable across every chapter should live here.
 */
export interface Book {
  siteId: string;           // Site integration identifier
  seriesId: string;         // Namespaced series id (siteId:rawId)
  seriesTitle: string;      // Display title
  coverUrl?: string;        // Cover image URL
  comicInfoBase: ComicInfoV2; // Base ComicInfo fields (no PageCount, no chapter-specific Number)
}
