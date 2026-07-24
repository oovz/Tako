import type { ExtensionSettings } from "@/src/storage/settings-types"
import type { SiteOverrideRecord } from "@/src/storage/site-overrides-service"
import type { TaskSettingsSnapshot } from "@/src/types/state-snapshots"
import type { SeriesMetadataSnapshot } from "@/src/types/state-snapshots"
import {
  canonicalizeSettingsDocument,
  SETTINGS_LIMITS,
} from "@/src/storage/settings-service"

type SitePolicyDefaults = {
  image?: Partial<ExtensionSettings["globalPolicy"]["image"]>
  chapter?: Partial<ExtensionSettings["globalPolicy"]["chapter"]>
}

function canonicalizePolicy(
  policy: Partial<ExtensionSettings["globalPolicy"]["image"]>,
  fallback: ExtensionSettings["globalPolicy"]["image"]
): ExtensionSettings["globalPolicy"]["image"] {
  const rawConcurrency = policy.concurrency ?? fallback.concurrency
  const rawDelayMs = policy.delayMs ?? fallback.delayMs
  const concurrency = Number.isFinite(rawConcurrency)
    ? Math.min(
        SETTINGS_LIMITS.MAX_CONCURRENCY,
        Math.max(SETTINGS_LIMITS.MIN_CONCURRENCY, Math.trunc(rawConcurrency))
      )
    : fallback.concurrency
  const delayMs = Number.isFinite(rawDelayMs)
    ? Math.max(SETTINGS_LIMITS.MIN_DELAY_MS, rawDelayMs)
    : fallback.delayMs

  return { concurrency, delayMs }
}

function canonicalizeRetryCount(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(
    SETTINGS_LIMITS.MAX_RETRIES,
    Math.max(SETTINGS_LIMITS.MIN_RETRIES, Math.trunc(value))
  )
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
  const canonicalSettings = canonicalizeSettingsDocument(settings)
  if (!canonicalSettings) {
    throw new Error("Cannot create task snapshot from invalid settings")
  }

  const {
    siteSettings = {},
    siteOverride,
    sitePolicyDefaults,
    comicInfo,
  } = options
  const canonicalSiteOverride = siteOverride
  const imagePolicy = canonicalizePolicy(
    {
      ...canonicalSettings.globalPolicy.image,
      ...(sitePolicyDefaults?.image ?? {}),
      ...(canonicalSiteOverride?.imagePolicy ?? {}),
    },
    canonicalSettings.globalPolicy.image
  )
  const chapterPolicy = canonicalizePolicy(
    {
      ...canonicalSettings.globalPolicy.chapter,
      ...(sitePolicyDefaults?.chapter ?? {}),
      delayMs:
        canonicalSiteOverride?.chapterPolicy?.delayMs ??
        sitePolicyDefaults?.chapter?.delayMs ??
        canonicalSettings.globalPolicy.chapter.delayMs,
      concurrency: 1,
    },
    canonicalSettings.globalPolicy.chapter
  )
  chapterPolicy.concurrency = 1

  return {
    archiveFormat:
      canonicalSiteOverride?.outputFormat ??
      canonicalSettings.downloads.defaultFormat,
    destination: canonicalSettings.downloads.destination,
    conflictPolicy: canonicalSettings.downloads.conflictPolicy,
    pathTemplate:
      canonicalSiteOverride?.pathTemplate ??
      canonicalSettings.downloads.pathTemplate,
    fileNameTemplate:
      canonicalSettings.downloads.fileNameTemplate || "<CHAPTER_TITLE>",
    includeComicInfo: canonicalSettings.downloads.includeComicInfo,
    includeCoverImage: canonicalSettings.downloads.includeCoverImage,
    siteSettings: { ...siteSettings },
    rateLimitSettings: {
      image: imagePolicy,
      chapter: chapterPolicy,
    },
    retrySettings: {
      image: canonicalizeRetryCount(
        canonicalSiteOverride?.retries?.image ??
          canonicalSettings.globalRetries.image,
        canonicalSettings.globalRetries.image
      ),
      chapter: canonicalizeRetryCount(
        canonicalSiteOverride?.retries?.chapter ??
          canonicalSettings.globalRetries.chapter,
        canonicalSettings.globalRetries.chapter
      ),
    },
    normalizeImageFilenames:
      canonicalSettings.downloads.normalizeImageFilenames,
    imagePaddingDigits: canonicalSettings.downloads.imagePaddingDigits,
    comicInfo,
    siteIntegrationId,
  }
}
