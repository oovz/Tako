import { normalizeSeriesMetadataSnapshot } from "@/src/runtime/series-data-normalization"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import type { SiteOverrideRecord } from "@/src/domain/site-integrations/storage-schemas"
import type { TaskSettingsSnapshot } from "@/src/types/state-snapshots"
import type { SeriesMetadataSnapshot } from "@/src/types/state-snapshots"
import { parseSettingsDocument } from "@/src/domain/settings/schema"

type SitePolicyDefaults = {
  image?: Partial<ExtensionSettings["globalPolicy"]["image"]>
  chapter?: Partial<ExtensionSettings["globalPolicy"]["chapter"]>
}

export function createTaskSettingsSnapshot(
  settings: ExtensionSettings,
  siteIntegrationId: string,
  options: {
    siteSettings?: Record<string, unknown>
    siteOverride?: SiteOverrideRecord
    sitePolicyDefaults?: SitePolicyDefaults
    comicInfo?: SeriesMetadataSnapshot
  } = {}
): TaskSettingsSnapshot {
  const canonicalSettings = parseSettingsDocument(settings)

  const {
    siteSettings = {},
    siteOverride,
    sitePolicyDefaults,
    comicInfo,
  } = options
  const canonicalSiteOverride = siteOverride
  const imagePolicy = {
    ...canonicalSettings.globalPolicy.image,
    ...(sitePolicyDefaults?.image ?? {}),
    ...(canonicalSiteOverride?.imagePolicy ?? {}),
  }
  const chapterPolicy = {
    concurrency: 1 as const,
    delayMs:
      canonicalSiteOverride?.chapterPolicy?.delayMs ??
      sitePolicyDefaults?.chapter?.delayMs ??
      canonicalSettings.globalPolicy.chapter.delayMs,
  }

  return {
    archiveFormat:
      canonicalSiteOverride?.outputFormat ??
      canonicalSettings.downloads.defaultFormat,
    destination: canonicalSettings.downloads.destination,
    conflictPolicy: canonicalSettings.downloads.conflictPolicy,
    pathTemplate:
      canonicalSiteOverride?.pathTemplate ??
      canonicalSettings.downloads.pathTemplate,
    fileNameTemplate: canonicalSettings.downloads.fileNameTemplate,
    includeComicInfo: canonicalSettings.downloads.includeComicInfo,
    includeCoverImage: canonicalSettings.downloads.includeCoverImage,
    siteSettings: { ...siteSettings },
    rateLimitSettings: {
      image: imagePolicy,
      chapter: chapterPolicy,
    },
    retrySettings: {
      image:
        canonicalSiteOverride?.retries?.image ??
        canonicalSettings.globalRetries.image,
      chapter:
        canonicalSiteOverride?.retries?.chapter ??
        canonicalSettings.globalRetries.chapter,
    },
    normalizeImageFilenames:
      canonicalSettings.downloads.normalizeImageFilenames,
    imagePaddingDigits: canonicalSettings.downloads.imagePaddingDigits,
    comicInfo: normalizeSeriesMetadataSnapshot(comicInfo),
    siteIntegrationId,
  }
}
