import type { ExtensionSettings } from '@/src/storage/settings-types';
import type { DownloadErrorCategory, DownloadTaskStatus } from '@/src/shared/download-contract';
import type { ChapterStatus } from '@/src/types/chapter';
import type { TaskSettingsSnapshot } from '@/src/types/state-snapshots';

export interface TaskChapter {
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
  errorMessage?: string;
  totalImages?: number;
  imagesFailed?: number;
  lastUpdated: number;
}

export interface DownloadTaskState {
  id: string;
  siteIntegrationId: string;
  mangaId: string;
  seriesTitle: string;
  seriesCoverUrl?: string;
  chapters: TaskChapter[];
  status: DownloadTaskStatus;
  errorMessage?: string;
  errorCategory?: DownloadErrorCategory;
  created: number;
  started?: number;
  completed?: number;
  isRetried?: boolean;
  isRetryTask?: boolean;
  lastSuccessfulDownloadId?: number;
  settingsSnapshot: TaskSettingsSnapshot;
}

export interface QueueTaskSummary {
  id: string;
  seriesKey: string;
  seriesTitle: string;
  siteIntegration: string;
  coverUrl?: string;
  status: DownloadTaskStatus;
  chapters: {
    total: number;
    completed: number;
    unsuccessful: number;
  };
  timestamps: {
    created: number;
    completed?: number;
  };
  failureReason?: string;
  failureCategory?: DownloadErrorCategory;
  isRetried?: boolean;
  isRetryTask?: boolean;
  lastSuccessfulDownloadId?: number;
}

export interface GlobalAppState {
  downloadQueue: DownloadTaskState[];
  settings: ExtensionSettings;
  lastActivity: number;
}
