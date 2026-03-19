import type { ChapterStatus } from '@/src/types/chapter';
import type { SeriesMetadataSnapshot } from '@/src/types/state-snapshots';

export interface ChapterState {
  id: string;
  url: string;
  title: string;
  locked?: boolean;
  index: number;
  language?: string;
  chapterLabel?: string;
  chapterNumber?: number;
  volumeNumber?: number;
  volumeLabel?: string;
  status: ChapterStatus;
  progress?: number;
  downloadId?: string;
  errorMessage?: string;
  totalImages?: number;
  imagesFailed?: number;
  lastUpdated: number;
}

export interface VolumeState {
  id: string;
  title?: string;
  label?: string;
}

export interface MangaPageState {
  siteIntegrationId: string;
  mangaId: string;
  seriesTitle: string;
  chapters: ChapterState[];
  volumes: VolumeState[];
  metadata?: SeriesMetadataSnapshot;
  lastUpdated: number;
}
