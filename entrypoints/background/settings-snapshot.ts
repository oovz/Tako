import type { ExtensionSettings } from '@/src/storage/settings-types'
import type { SiteOverrideRecord } from '@/src/storage/site-overrides-service'
import type { TaskSettingsSnapshot } from '@/src/types/state-snapshots'
import type { SeriesMetadataSnapshot } from '@/src/types/state-snapshots'

export function createTaskSettingsSnapshot(
  settings: ExtensionSettings,
  siteIntegrationId: string,
  options: {
    siteSettings?: Record<string, unknown>
    siteOverride?: SiteOverrideRecord
    comicInfo?: SeriesMetadataSnapshot
  } = {},
): TaskSettingsSnapshot {
  const { siteSettings = {}, siteOverride, comicInfo } = options

  return {
    archiveFormat: siteOverride?.outputFormat ?? settings.downloads.defaultFormat,
    overwriteExisting: settings.downloads.overwriteExisting,
    pathTemplate: siteOverride?.pathTemplate ?? settings.downloads.pathTemplate,
    fileNameTemplate: settings.downloads.fileNameTemplate || '<CHAPTER_TITLE>',
    includeComicInfo: settings.downloads.includeComicInfo,
    includeCoverImage: settings.downloads.includeCoverImage ?? true,
    siteSettings: { ...siteSettings },
    rateLimitSettings: {
      image: {
        ...settings.globalPolicy.image,
        ...(siteOverride?.imagePolicy ?? {}),
      },
      chapter: {
        ...settings.globalPolicy.chapter,
        ...(siteOverride?.chapterPolicy ?? {}),
      },
    },
    normalizeImageFilenames: settings.downloads.normalizeImageFilenames,
    imagePaddingDigits: settings.downloads.imagePaddingDigits,
    comicInfo,
    siteIntegrationId,
  }
}
