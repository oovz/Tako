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

function resolveImagePolicy(
  settings: ExtensionSettings,
  siteOverride: SiteOverrideRecord | undefined,
  sitePolicyDefaults: SitePolicyDefaults | undefined
): TaskSettingsSnapshot["rateLimitSettings"]["image"] {
  return {
    ...settings.globalPolicy.image,
    ...(sitePolicyDefaults?.image ?? {}),
    ...(siteOverride?.imagePolicy ?? {}),
  }
}

function resolveChapterPolicy(
  settings: ExtensionSettings,
  siteOverride: SiteOverrideRecord | undefined,
  sitePolicyDefaults: SitePolicyDefaults | undefined
): TaskSettingsSnapshot["rateLimitSettings"]["chapter"] {
  return {
    concurrency: 1,
    delayMs:
      siteOverride?.chapterPolicy?.delayMs ??
      sitePolicyDefaults?.chapter?.delayMs ??
      settings.globalPolicy.chapter.delayMs,
  }
}

function resolveRetrySettings(
  settings: ExtensionSettings,
  siteOverride: SiteOverrideRecord | undefined
): TaskSettingsSnapshot["retrySettings"] {
  return {
    image: siteOverride?.retries?.image ?? settings.globalRetries.image,
    chapter: siteOverride?.retries?.chapter ?? settings.globalRetries.chapter,
  }
}

function captureDestination(
  settings: ExtensionSettings
): Pick<TaskSettingsSnapshot, "destination" | "allowChromeFallback"> {
  if (settings.downloads.destination === "downloads-api") {
    return { destination: { kind: "downloads-api" } }
  }
  return {
    destination: {
      kind: "file-system-access",
      handleId: settings.downloads.customDirectoryHandleId,
    },
    ...(settings.downloads.allowChromeFallback
      ? { allowChromeFallback: true as const }
      : {}),
  }
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
  return {
    ...captureDestination(canonicalSettings),
    archiveFormat:
      siteOverride?.outputFormat ?? canonicalSettings.downloads.defaultFormat,
    conflictPolicy: canonicalSettings.downloads.conflictPolicy,
    pathTemplate:
      siteOverride?.pathTemplate ?? canonicalSettings.downloads.pathTemplate,
    fileNameTemplate: canonicalSettings.downloads.fileNameTemplate,
    includeComicInfo: canonicalSettings.downloads.includeComicInfo,
    includeCoverImage: canonicalSettings.downloads.includeCoverImage,
    siteSettings: { ...siteSettings },
    rateLimitSettings: {
      image: resolveImagePolicy(
        canonicalSettings,
        siteOverride,
        sitePolicyDefaults
      ),
      chapter: resolveChapterPolicy(
        canonicalSettings,
        siteOverride,
        sitePolicyDefaults
      ),
    },
    retrySettings: resolveRetrySettings(canonicalSettings, siteOverride),
    normalizeImageFilenames:
      canonicalSettings.downloads.normalizeImageFilenames,
    imagePaddingDigits: canonicalSettings.downloads.imagePaddingDigits,
    comicInfo: normalizeSeriesMetadataSnapshot(comicInfo),
    siteIntegrationId,
  }
}
