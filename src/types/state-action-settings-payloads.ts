import type { ExtensionSettings } from '@/src/storage/settings-types';

export interface UpdateSettingsPayload {
  settings: Partial<ExtensionSettings>;
}

export interface ClearDownloadHistoryPayload {
  seriesId?: string;
}
