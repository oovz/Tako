import type { ExtensionSettings } from '@/src/storage/settings-types';
import type { SeriesMetadata } from '@/src/types/series-metadata';

export type SeriesMetadataSnapshot = Omit<SeriesMetadata, 'title'>;

export interface TaskSettingsSnapshot {
  archiveFormat: ExtensionSettings['downloads']['defaultFormat'];
  overwriteExisting: boolean;
  pathTemplate: string;
  fileNameTemplate?: string;
  includeComicInfo: boolean;
  includeCoverImage: boolean;
  siteSettings: Record<string, unknown>;
  rateLimitSettings: {
    image: ExtensionSettings['globalPolicy']['image'];
    chapter: ExtensionSettings['globalPolicy']['chapter'];
  };
  normalizeImageFilenames: ExtensionSettings['downloads']['normalizeImageFilenames'];
  imagePaddingDigits: ExtensionSettings['downloads']['imagePaddingDigits'];
  comicInfo?: SeriesMetadataSnapshot;
  siteIntegrationId: string;
}
