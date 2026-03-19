import type { ComicInfoV2 } from './comic-info';

/**
 * Chapter status enumeration
 */
export type ChapterStatus =
  | 'queued'         // Enqueued for download
  | 'downloading'    // In progress
  | 'completed'      // Finished successfully (was 'downloaded')
  | 'partial_success'// Some images failed but successful ones kept (NONE format only)
  | 'failed';        // Finished with error (was 'error')

/**
 * Minimal input needed to compose a Chapter (pre-composition stage).
 * This matches raw chapter extraction + id coming from the site integration.
 */
export interface ChapterInput {
  id: string;              // Site-integration-provided unique chapter id (required)
  url: string;             // Chapter URL
  title: string;           // Chapter title
  locked?: boolean;        // Chapter visible on source page but unavailable for download
  language?: string;       // Chapter-level language override when the site provides per-chapter language
  chapterLabel?: string;   // Raw chapter number string as seen on site (e.g., '12.5')
  chapterNumber?: number;  // Parsed numeric chapter number
  volumeNumber?: number;   // Parsed volume number
  volumeLabel?: string;    // Raw volume label (e.g., 'Vol. 01')
}

/**
 * Final Chapter object used internally for download + offscreen work.
 * Holds resolved ComicInfo (minus PageCount until images known) and path.
 */
export interface Chapter {
  id: string;
  url: string;
  title: string;
  locked?: boolean;            // Chapter visible on source page but unavailable for download
  language?: string;           // Chapter-level language propagated into ComicInfo generation when present
  /** Original string representation of chapter number (e.g., '12.5') */
  chapterLabel?: string;
  chapterNumber?: number;
  volumeNumber?: number;
  volumeLabel?: string;
  resolvedPath?: string;        // Filled in by download planning
  comicInfo: ComicInfoV2;  // Already merged with book.comicInfoBase (no PageCount yet)
}
