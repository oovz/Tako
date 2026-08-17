import { z } from "zod"

import { rebuildSeriesHistory } from "@/src/domain/history/cleanup-policy"
import {
  DownloadedChapterRecordSchema,
  parseHistoryAggregate,
} from "@/src/domain/history/schema"
import {
  composeDownloadedChapterKey,
  type DownloadedChapterRecord,
} from "@/src/domain/history/types"
import { normalizeInterruptedTask } from "@/src/domain/queue/task-lifecycle"
import type {
  DownloadTaskState,
  PendingUndoAction,
} from "@/src/domain/queue/state"
import { createDefaultSettings } from "@/src/domain/settings/defaults"
import {
  parseSettingsDocument,
  SETTINGS_LIMITS,
} from "@/src/domain/settings/schema"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import {
  SiteOverrideRecordSchema,
  type SiteOverrideRecord,
} from "@/src/domain/site-integrations/storage-schemas"
import { DestinationIssuesSchema } from "@/src/runtime/destination-issue-state"
import logger from "@/src/runtime/logger"
import { PersistentErrorsSchema } from "@/src/runtime/persistent-error-schema"
import {
  ActiveDispatchLeaseSchema,
  DownloadTaskStateSchema,
  PendingUndoActionSchema,
} from "@/src/runtime/queue-state-schemas"
import { SeriesMetadataSnapshotSchema } from "@/src/runtime/series-data-schemas"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import {
  ARCHIVE_FORMATS,
  CONFLICT_POLICIES,
  DOWNLOAD_DESTINATIONS,
  IMAGE_PADDING_DIGITS,
  LOG_LEVELS,
  normalizeDownloadErrorCategory,
} from "@/src/shared/download-contract"
import {
  LegacyTaskSettingsSnapshotSchema,
  LegacyDownloadTaskSchema,
  LegacyPendingUndoActionSchema,
  LegacyDownloadedChapterSchema,
  LegacyHistoryCutoffsSchema,
} from "./state-schema-migration-legacy-schemas"
import { MOTION_PREFERENCES } from "@/src/shared/motion-preference"
import {
  clampRatePolicyInteger,
  RATE_POLICY_LIMITS,
} from "@/src/shared/rate-policy-limits"
import { UI_LANGUAGE_PREFERENCES } from "@/src/shared/ui-language"
import { isRecord } from "@/src/shared/type-guards"
import {
  assertValidSettingsFieldValue,
  getDefinition,
} from "@/src/site-integrations/catalog"
import { DOWNLOAD_ROOT_HANDLE_ID } from "@/src/storage/fs-access"
import {
  parseSiteIntegrationEnablementDocument,
  SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY,
} from "@/src/storage/site-integration-enablement-service"
import {
  parseSiteIntegrationSettingsDocument,
  SITE_INTEGRATION_SETTINGS_STORAGE_KEY,
} from "@/src/storage/site-integration-settings-service"
import {
  parseSiteOverridesDocument,
  SITE_OVERRIDES_STORAGE_KEY,
} from "@/src/storage/site-overrides-service"

export const CURRENT_STATE_SCHEMA_EPOCH = 2

const SCHEMA_EPOCH_STORAGE_KEY = "stateSchemaEpoch"
const OBSOLETE_COMMAND_RESULTS_KEY = "commandResults"
const UPDATE_INTERRUPTION_MESSAGE =
  "Download interrupted by extension update; restart the task to continue"

const MIGRATION_STORAGE_KEYS = [
  SCHEMA_EPOCH_STORAGE_KEY,
  ...Object.values(LOCAL_STORAGE_KEYS),
  SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY,
  SITE_INTEGRATION_SETTINGS_STORAGE_KEY,
  SITE_OVERRIDES_STORAGE_KEY,
  OBSOLETE_COMMAND_RESULTS_KEY,
] as const

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clampRatePolicyInteger(value, minimum, maximum)
    : fallback
}

function nonemptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback
}

function canonicalizeSettings(raw: unknown): ExtensionSettings | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) throw new Error("Stored settings are not an object")

  const defaults = createDefaultSettings("warn")
  const downloads = isRecord(raw.downloads) ? raw.downloads : {}
  const globalPolicy = isRecord(raw.globalPolicy) ? raw.globalPolicy : {}
  const imagePolicy = isRecord(globalPolicy.image) ? globalPolicy.image : {}
  const chapterPolicy = isRecord(globalPolicy.chapter)
    ? globalPolicy.chapter
    : {}
  const retries = isRecord(raw.globalRetries) ? raw.globalRetries : {}
  const advanced = isRecord(raw.advanced) ? raw.advanced : {}

  const canonicalDestination = DOWNLOAD_DESTINATIONS.find(
    (candidate) => candidate === downloads.destination
  )
  const legacyDestination =
    downloads.downloadMode === "custom" ||
    downloads.customDirectoryEnabled === true
      ? "file-system-access"
      : downloads.downloadMode === "browser" ||
          downloads.customDirectoryEnabled === false
        ? "downloads-api"
        : undefined
  const destination =
    canonicalDestination ?? legacyDestination ?? defaults.downloads.destination

  const canonicalConflictPolicy = CONFLICT_POLICIES.find(
    (candidate) => candidate === downloads.conflictPolicy
  )
  const legacyConflictPolicy =
    destination === "file-system-access"
      ? downloads.fsaCollisionPolicy === "overwrite"
        ? "overwrite"
        : downloads.fsaCollisionPolicy === "skip"
          ? "uniquify"
          : undefined
      : typeof downloads.overwriteExisting === "boolean"
        ? downloads.overwriteExisting
          ? "overwrite"
          : "uniquify"
        : undefined

  const handleId =
    typeof downloads.customDirectoryHandleId === "string" &&
    downloads.customDirectoryHandleId.length > 0
      ? downloads.customDirectoryHandleId
      : downloads.customDirectoryHandleId === null
        ? null
        : destination === "file-system-access"
          ? DOWNLOAD_ROOT_HANDLE_ID
          : defaults.downloads.customDirectoryHandleId

  const settings: ExtensionSettings = {
    downloads: {
      destination,
      customDirectoryHandleId:
        destination === "file-system-access" && handleId === null
          ? DOWNLOAD_ROOT_HANDLE_ID
          : handleId,
      pathTemplate: nonemptyString(
        downloads.pathTemplate,
        defaults.downloads.pathTemplate
      ),
      defaultFormat:
        ARCHIVE_FORMATS.find(
          (candidate) => candidate === downloads.defaultFormat
        ) ?? defaults.downloads.defaultFormat,
      fileNameTemplate: nonemptyString(
        downloads.fileNameTemplate,
        defaults.downloads.fileNameTemplate
      ),
      conflictPolicy:
        canonicalConflictPolicy ??
        legacyConflictPolicy ??
        defaults.downloads.conflictPolicy,
      suppressSaveAsDialog:
        typeof downloads.suppressSaveAsDialog === "boolean"
          ? downloads.suppressSaveAsDialog
          : defaults.downloads.suppressSaveAsDialog,
      includeComicInfo:
        typeof downloads.includeComicInfo === "boolean"
          ? downloads.includeComicInfo
          : defaults.downloads.includeComicInfo,
      includeCoverImage:
        typeof downloads.includeCoverImage === "boolean"
          ? downloads.includeCoverImage
          : defaults.downloads.includeCoverImage,
      normalizeImageFilenames:
        typeof downloads.normalizeImageFilenames === "boolean"
          ? downloads.normalizeImageFilenames
          : defaults.downloads.normalizeImageFilenames,
      imagePaddingDigits:
        IMAGE_PADDING_DIGITS.find(
          (candidate) => candidate === downloads.imagePaddingDigits
        ) ?? defaults.downloads.imagePaddingDigits,
    },
    globalPolicy: {
      image: {
        concurrency: boundedInteger(
          imagePolicy.concurrency,
          defaults.globalPolicy.image.concurrency,
          RATE_POLICY_LIMITS.MIN_CONCURRENCY,
          RATE_POLICY_LIMITS.MAX_CONCURRENCY
        ),
        delayMs: boundedInteger(
          imagePolicy.delayMs,
          defaults.globalPolicy.image.delayMs,
          RATE_POLICY_LIMITS.MIN_DELAY_MS,
          RATE_POLICY_LIMITS.MAX_DELAY_MS
        ),
      },
      chapter: {
        concurrency: 1,
        delayMs: boundedInteger(
          chapterPolicy.delayMs,
          defaults.globalPolicy.chapter.delayMs,
          RATE_POLICY_LIMITS.MIN_DELAY_MS,
          RATE_POLICY_LIMITS.MAX_DELAY_MS
        ),
      },
    },
    globalRetries: {
      image: boundedInteger(
        retries.image,
        defaults.globalRetries.image,
        SETTINGS_LIMITS.MIN_RETRIES,
        SETTINGS_LIMITS.MAX_RETRIES
      ),
      chapter: boundedInteger(
        retries.chapter,
        defaults.globalRetries.chapter,
        SETTINGS_LIMITS.MIN_RETRIES,
        SETTINGS_LIMITS.MAX_RETRIES
      ),
    },
    notifications:
      typeof raw.notifications === "boolean"
        ? raw.notifications
        : defaults.notifications,
    motionPreference:
      MOTION_PREFERENCES.find(
        (candidate) => candidate === raw.motionPreference
      ) ?? defaults.motionPreference,
    uiLanguage:
      UI_LANGUAGE_PREFERENCES.find(
        (candidate) => candidate === raw.uiLanguage
      ) ?? defaults.uiLanguage,
    advanced: {
      logLevel:
        LOG_LEVELS.find((candidate) => candidate === advanced.logLevel) ??
        defaults.advanced.logLevel,
      storageCleanupDays:
        typeof advanced.storageCleanupDays === "number" &&
        Number.isFinite(advanced.storageCleanupDays) &&
        advanced.storageCleanupDays >= 0
          ? advanced.storageCleanupDays
          : defaults.advanced.storageCleanupDays,
    },
  }
  return parseSettingsDocument(settings)
}

function snapshotMetadata(
  raw: unknown
): z.infer<typeof SeriesMetadataSnapshotSchema> | undefined {
  if (!isRecord(raw)) return undefined
  const candidate = { ...raw }
  delete candidate.title
  return SeriesMetadataSnapshotSchema.safeParse(candidate).data
}

function migrateDownloadTask(raw: unknown): DownloadTaskState {
  const current = DownloadTaskStateSchema.safeParse(raw)
  if (current.success) return current.data

  const legacy = LegacyDownloadTaskSchema.parse(raw)
  const rawSnapshot = isRecord(legacy.settingsSnapshot)
    ? legacy.settingsSnapshot
    : isRecord(legacy.taskSettingsSnapshot)
      ? legacy.taskSettingsSnapshot
      : undefined
  const parsedSnapshot = rawSnapshot
    ? LegacyTaskSettingsSnapshotSchema.parse(rawSnapshot)
    : undefined
  const baseSnapshot = createTaskSettingsSnapshot(
    createDefaultSettings("warn"),
    legacy.siteIntegrationId,
    {
      comicInfo: snapshotMetadata(legacy.seriesMetadata),
    }
  )
  const imagePolicy = parsedSnapshot?.rateLimitSettings?.image
  const chapterPolicy = parsedSnapshot?.rateLimitSettings?.chapter
  const settingsSnapshot = {
    ...baseSnapshot,
    archiveFormat: parsedSnapshot?.archiveFormat ?? baseSnapshot.archiveFormat,
    destination: parsedSnapshot?.destination ?? "downloads-api",
    conflictPolicy:
      parsedSnapshot?.conflictPolicy ??
      (parsedSnapshot?.destination === "file-system-access"
        ? parsedSnapshot.fsaCollisionPolicy === "overwrite"
          ? "overwrite"
          : "uniquify"
        : parsedSnapshot?.overwriteExisting
          ? "overwrite"
          : "uniquify"),
    pathTemplate: parsedSnapshot?.pathTemplate ?? baseSnapshot.pathTemplate,
    fileNameTemplate:
      parsedSnapshot?.fileNameTemplate ?? baseSnapshot.fileNameTemplate,
    includeComicInfo:
      parsedSnapshot?.includeComicInfo ?? baseSnapshot.includeComicInfo,
    includeCoverImage:
      parsedSnapshot?.includeCoverImage ?? baseSnapshot.includeCoverImage,
    siteSettings: parsedSnapshot?.siteSettings ?? baseSnapshot.siteSettings,
    rateLimitSettings: {
      image: {
        concurrency: boundedInteger(
          imagePolicy?.concurrency,
          baseSnapshot.rateLimitSettings.image.concurrency,
          RATE_POLICY_LIMITS.MIN_CONCURRENCY,
          RATE_POLICY_LIMITS.MAX_CONCURRENCY
        ),
        delayMs: boundedInteger(
          imagePolicy?.delayMs,
          baseSnapshot.rateLimitSettings.image.delayMs,
          RATE_POLICY_LIMITS.MIN_DELAY_MS,
          RATE_POLICY_LIMITS.MAX_DELAY_MS
        ),
      },
      chapter: {
        concurrency: 1 as const,
        delayMs: boundedInteger(
          chapterPolicy?.delayMs,
          baseSnapshot.rateLimitSettings.chapter.delayMs,
          RATE_POLICY_LIMITS.MIN_DELAY_MS,
          RATE_POLICY_LIMITS.MAX_DELAY_MS
        ),
      },
    },
    retrySettings: {
      image: boundedInteger(
        parsedSnapshot?.retrySettings?.image,
        baseSnapshot.retrySettings.image,
        SETTINGS_LIMITS.MIN_RETRIES,
        SETTINGS_LIMITS.MAX_RETRIES
      ),
      chapter: boundedInteger(
        parsedSnapshot?.retrySettings?.chapter,
        baseSnapshot.retrySettings.chapter,
        SETTINGS_LIMITS.MIN_RETRIES,
        SETTINGS_LIMITS.MAX_RETRIES
      ),
    },
    normalizeImageFilenames:
      parsedSnapshot?.normalizeImageFilenames ??
      baseSnapshot.normalizeImageFilenames,
    imagePaddingDigits:
      parsedSnapshot?.imagePaddingDigits ?? baseSnapshot.imagePaddingDigits,
    comicInfo:
      snapshotMetadata(parsedSnapshot?.comicInfo) ?? baseSnapshot.comicInfo,
    siteIntegrationId: legacy.siteIntegrationId,
  }

  return DownloadTaskStateSchema.parse({
    id: legacy.id,
    siteIntegrationId: legacy.siteIntegrationId,
    mangaId: legacy.mangaId,
    seriesTitle: legacy.seriesTitle,
    seriesCoverUrl: legacy.seriesCoverUrl,
    chapters: legacy.chapters.map((chapter) => ({
      ...chapter,
      locked: chapter.locked === true,
      errorCategory: normalizeDownloadErrorCategory(chapter.errorCategory),
      totalImages:
        typeof chapter.totalImages === "number" &&
        Number.isInteger(chapter.totalImages) &&
        chapter.totalImages >= 0
          ? chapter.totalImages
          : undefined,
      imagesFailed:
        typeof chapter.imagesFailed === "number" &&
        Number.isInteger(chapter.imagesFailed) &&
        chapter.imagesFailed >= 0
          ? chapter.imagesFailed
          : undefined,
      outputs: {
        requested: chapter.outputs?.requested ?? 0,
        committed: chapter.outputs?.committed ?? 0,
        failed: chapter.outputs?.failed ?? 0,
      },
    })),
    status: legacy.status,
    errorMessage: legacy.errorMessage,
    errorCategory: normalizeDownloadErrorCategory(legacy.errorCategory),
    activeBlock: legacy.activeBlock,
    destinationOverride: legacy.destinationOverride,
    created: legacy.created,
    started: legacy.started,
    completed: legacy.completed,
    isRetried: legacy.isRetried === true,
    isRetryTask: legacy.isRetryTask === true,
    lastSuccessfulDownloadId: legacy.lastSuccessfulDownloadId,
    nextChapterDispatchAt: legacy.nextChapterDispatchAt,
    settingsSnapshot,
  })
}

function migrateQueue(raw: unknown): DownloadTaskState[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw))
    throw new Error("Stored download queue is not an array")
  const queue = raw.map(migrateDownloadTask)
  if (new Set(queue.map((task) => task.id)).size !== queue.length) {
    throw new Error("Stored download queue contains duplicate task IDs")
  }
  return queue
}

function migratePendingUndoActions(raw: unknown): PendingUndoAction[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw))
    throw new Error("Stored pending Undo actions are not an array")
  return raw.map((value) => {
    const current = PendingUndoActionSchema.safeParse(value)
    if (current.success) return current.data
    const legacy = LegacyPendingUndoActionSchema.parse(value)
    return PendingUndoActionSchema.parse({
      ...legacy,
      taskSnapshot: migrateDownloadTask(legacy.taskSnapshot),
    })
  })
}

function resolveLegacyHistorySiteIntegrationId(url: string): string {
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, "")
  } catch {
    return "legacy-unresolved"
  }
  const releasedDomains = [
    ["mangadex", "mangadex.org"],
    ["pixiv-comic", "comic.pixiv.net"],
    ["shonenjumpplus", "shonenjumpplus.com"],
    ["manhuagui", "manhuagui.com"],
    ["comicnettai", "comicnettai.com"],
  ] as const
  return (
    releasedDomains.find(
      ([, domain]) => hostname === domain || hostname.endsWith(`.${domain}`)
    )?.[0] ?? `legacy:${hostname || "unresolved"}`
  )
}

function migrateHistoryRecord(
  raw: unknown,
  fallbackSiteIntegrationId?: string
): DownloadedChapterRecord {
  const current = DownloadedChapterRecordSchema.safeParse(raw)
  if (current.success) return current.data
  const legacy = LegacyDownloadedChapterSchema.parse(raw)
  return DownloadedChapterRecordSchema.parse({
    ...legacy,
    siteIntegrationId:
      legacy.siteIntegrationId ??
      fallbackSiteIntegrationId ??
      resolveLegacyHistorySiteIntegrationId(legacy.url),
  })
}

function migrateHistory(
  stored: Record<string, unknown>
): Record<string, unknown> | undefined {
  const hasHistory = [
    LOCAL_STORAGE_KEYS.downloadedChapters,
    LOCAL_STORAGE_KEYS.seriesDownloadHistory,
    LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs,
  ].some((key) => key in stored)
  if (!hasHistory) return undefined

  const records: DownloadedChapterRecord[] = []
  const rawChapters = stored[LOCAL_STORAGE_KEYS.downloadedChapters]
  if (rawChapters !== undefined) {
    if (!Array.isArray(rawChapters))
      throw new Error("Stored downloaded chapters are not an array")
    records.push(...rawChapters.map((record) => migrateHistoryRecord(record)))
  } else {
    const rawSeries = stored[LOCAL_STORAGE_KEYS.seriesDownloadHistory]
    if (!isRecord(rawSeries))
      throw new Error("Stored series history is not an object")
    for (const series of Object.values(rawSeries)) {
      if (!isRecord(series) || !Array.isArray(series.downloadedChapters)) {
        throw new Error("Stored series history entry is invalid")
      }
      const fallback =
        typeof series.siteIntegrationId === "string"
          ? series.siteIntegrationId
          : undefined
      records.push(
        ...series.downloadedChapters.map((record) =>
          migrateHistoryRecord(record, fallback)
        )
      )
    }
  }

  const byChapter = new Map<string, DownloadedChapterRecord>()
  for (const record of records) {
    const key = composeDownloadedChapterKey(
      record.siteIntegrationId,
      record.seriesId,
      record.chapterId
    )
    const existing = byChapter.get(key)
    if (!existing || record.downloadedAt >= existing.downloadedAt) {
      byChapter.set(key, record)
    }
  }
  const downloadedChapters = [...byChapter.values()]

  const parsedCutoffs = LegacyHistoryCutoffsSchema.parse(
    stored[LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs] ?? {}
  )
  const aggregate = parseHistoryAggregate({
    downloadedChapters,
    seriesDownloadHistory: rebuildSeriesHistory(downloadedChapters),
    clearCutoffs: {
      ...(parsedCutoffs.allBefore === undefined
        ? {}
        : { allBefore: parsedCutoffs.allBefore }),
      bySeries: parsedCutoffs.bySeries ?? {},
      byChapter: parsedCutoffs.byChapter ?? {},
    },
  })
  return {
    [LOCAL_STORAGE_KEYS.downloadedChapters]: aggregate.downloadedChapters,
    [LOCAL_STORAGE_KEYS.seriesDownloadHistory]: aggregate.seriesDownloadHistory,
    [LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs]: aggregate.clearCutoffs,
  }
}

function warnDroppedProviderEntry(
  documentName: string,
  siteIntegrationId: string,
  field?: string
): void {
  logger.warn("[Migration] Dropped obsolete site-integration data", {
    documentName,
    siteIntegrationId,
    field,
  })
}

function migrateEnablement(raw: unknown): Record<string, boolean> | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw))
    throw new Error("Stored site-integration enablement is not an object")
  const migrated: Record<string, boolean> = {}
  for (const [siteIntegrationId, enabled] of Object.entries(raw)) {
    if (!getDefinition(siteIntegrationId) || typeof enabled !== "boolean") {
      warnDroppedProviderEntry("enablement", siteIntegrationId)
      continue
    }
    migrated[siteIntegrationId] = enabled
  }
  return parseSiteIntegrationEnablementDocument(migrated)
}

function migrateSiteSettings(
  raw: unknown
): Record<string, Record<string, unknown>> | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw))
    throw new Error("Stored site-integration settings are not an object")
  const migrated: Record<string, Record<string, unknown>> = {}
  for (const [siteIntegrationId, settings] of Object.entries(raw)) {
    const definition = getDefinition(siteIntegrationId)
    if (!definition || !isRecord(settings)) {
      warnDroppedProviderEntry("settings", siteIntegrationId)
      continue
    }
    const schemas = new Map(
      definition.customSettings.map((schema) => [schema.id, schema])
    )
    const current: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(settings)) {
      const schema = schemas.get(field)
      try {
        if (!schema) throw new Error("unknown field")
        assertValidSettingsFieldValue(schema, value)
        current[field] = value
      } catch {
        warnDroppedProviderEntry("settings", siteIntegrationId, field)
      }
    }
    migrated[siteIntegrationId] = current
  }
  return parseSiteIntegrationSettingsDocument(migrated)
}

function migrateSiteOverrides(
  raw: unknown
): Record<string, SiteOverrideRecord> | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) throw new Error("Stored site overrides are not an object")
  const migrated: Record<string, SiteOverrideRecord> = {}
  for (const [siteIntegrationId, override] of Object.entries(raw)) {
    if (!getDefinition(siteIntegrationId) || !isRecord(override)) {
      warnDroppedProviderEntry("overrides", siteIntegrationId)
      continue
    }
    const imagePolicy = isRecord(override.imagePolicy)
      ? override.imagePolicy
      : {}
    const chapterPolicy = isRecord(override.chapterPolicy)
      ? override.chapterPolicy
      : {}
    const retries = isRecord(override.retries) ? override.retries : {}
    const candidate: SiteOverrideRecord = {
      outputFormat: ARCHIVE_FORMATS.find(
        (format) => format === override.outputFormat
      ),
      pathTemplate:
        typeof override.pathTemplate === "string"
          ? override.pathTemplate
          : undefined,
      imagePolicy: {
        concurrency:
          typeof imagePolicy.concurrency === "number"
            ? boundedInteger(
                imagePolicy.concurrency,
                RATE_POLICY_LIMITS.MIN_CONCURRENCY,
                RATE_POLICY_LIMITS.MIN_CONCURRENCY,
                RATE_POLICY_LIMITS.MAX_CONCURRENCY
              )
            : undefined,
        delayMs:
          typeof imagePolicy.delayMs === "number"
            ? boundedInteger(
                imagePolicy.delayMs,
                RATE_POLICY_LIMITS.MIN_DELAY_MS,
                RATE_POLICY_LIMITS.MIN_DELAY_MS,
                RATE_POLICY_LIMITS.MAX_DELAY_MS
              )
            : undefined,
      },
      chapterPolicy: {
        delayMs:
          typeof chapterPolicy.delayMs === "number"
            ? boundedInteger(
                chapterPolicy.delayMs,
                RATE_POLICY_LIMITS.MIN_DELAY_MS,
                RATE_POLICY_LIMITS.MIN_DELAY_MS,
                RATE_POLICY_LIMITS.MAX_DELAY_MS
              )
            : undefined,
      },
      retries: {
        image:
          typeof retries.image === "number"
            ? boundedInteger(
                retries.image,
                SETTINGS_LIMITS.MIN_RETRIES,
                SETTINGS_LIMITS.MIN_RETRIES,
                SETTINGS_LIMITS.MAX_RETRIES
              )
            : undefined,
        chapter:
          typeof retries.chapter === "number"
            ? boundedInteger(
                retries.chapter,
                SETTINGS_LIMITS.MIN_RETRIES,
                SETTINGS_LIMITS.MIN_RETRIES,
                SETTINGS_LIMITS.MAX_RETRIES
              )
            : undefined,
      },
    }
    migrated[siteIntegrationId] = SiteOverrideRecordSchema.parse(candidate)
  }
  return parseSiteOverridesDocument(migrated)
}

function migratePersistentErrors(raw: unknown, now: number): unknown {
  if (raw === undefined) return undefined
  const current = PersistentErrorsSchema.safeParse(raw)
  if (current.success) return current.data
  if (!Array.isArray(raw))
    throw new Error("Stored persistent errors are not an array")
  return PersistentErrorsSchema.parse(
    raw.flatMap((value) => {
      if (
        !isRecord(value) ||
        typeof value.code !== "string" ||
        value.code.length === 0 ||
        typeof value.message !== "string"
      ) {
        return []
      }
      return [
        {
          code: value.code,
          message: value.message,
          severity: value.severity === "error" ? "error" : "warning",
          ts:
            typeof value.ts === "number" &&
            Number.isFinite(value.ts) &&
            value.ts >= 0
              ? value.ts
              : now,
        },
      ]
    })
  )
}

function legacyInFlightTaskIds(stored: Record<string, unknown>): Set<string> {
  const taskIds = new Set<string>()
  const lease = stored[LOCAL_STORAGE_KEYS.activeDispatchLease]
  if (isRecord(lease) && typeof lease.taskId === "string") {
    taskIds.add(lease.taskId)
  }
  const outputs = stored[LOCAL_STORAGE_KEYS.pendingOutputs]
  if (isRecord(outputs)) {
    for (const output of Object.values(outputs)) {
      if (isRecord(output) && typeof output.taskId === "string") {
        taskIds.add(output.taskId)
      }
    }
  }
  return taskIds
}

/**
 * One-time migration from released storage shapes into the current strict
 * documents. It runs before any repository hydrates, preserves the FSA
 * IndexedDB handle, and writes the epoch marker only after every canonical
 * write and obsolete-key removal succeeds.
 */
export async function migrateDurableStateForCurrentSchema(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([...MIGRATION_STORAGE_KEYS])
    const epoch = stored[SCHEMA_EPOCH_STORAGE_KEY]
    if (typeof epoch === "number" && epoch >= CURRENT_STATE_SCHEMA_EPOCH) return

    logger.info(
      `[Init] Migrating durable state schema from ${String(epoch)} to ${CURRENT_STATE_SCHEMA_EPOCH}`
    )

    const now = Date.now()
    let queue = migrateQueue(stored[LOCAL_STORAGE_KEYS.downloadQueue])
    const rawLease = stored[LOCAL_STORAGE_KEYS.activeDispatchLease]
    const currentLease = ActiveDispatchLeaseSchema.safeParse(rawLease)
    const inFlightTaskIds = legacyInFlightTaskIds(stored)
    const hasLegacyPendingOutputs = LOCAL_STORAGE_KEYS.pendingOutputs in stored
    if (
      (rawLease !== undefined && !currentLease.success) ||
      hasLegacyPendingOutputs
    ) {
      queue = queue.map((task) =>
        inFlightTaskIds.has(task.id) &&
        (task.status === "queued" || task.status === "downloading")
          ? normalizeInterruptedTask(task, UPDATE_INTERRUPTION_MESSAGE, now)
          : task
      )
    }

    const writes: Record<string, unknown> = {
      [LOCAL_STORAGE_KEYS.downloadQueue]: queue,
      [LOCAL_STORAGE_KEYS.pendingUndoActions]: migratePendingUndoActions(
        stored[LOCAL_STORAGE_KEYS.pendingUndoActions]
      ),
    }

    const settings = canonicalizeSettings(stored[LOCAL_STORAGE_KEYS.settings])
    if (settings) writes[LOCAL_STORAGE_KEYS.settings] = settings

    const history = migrateHistory(stored)
    if (history) Object.assign(writes, history)

    const enablement = migrateEnablement(
      stored[SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY]
    )
    if (enablement) writes[SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY] = enablement

    const siteSettings = migrateSiteSettings(
      stored[SITE_INTEGRATION_SETTINGS_STORAGE_KEY]
    )
    if (siteSettings)
      writes[SITE_INTEGRATION_SETTINGS_STORAGE_KEY] = siteSettings

    const siteOverrides = migrateSiteOverrides(
      stored[SITE_OVERRIDES_STORAGE_KEY]
    )
    if (siteOverrides) writes[SITE_OVERRIDES_STORAGE_KEY] = siteOverrides

    const persistentErrors = migratePersistentErrors(
      stored[LOCAL_STORAGE_KEYS.persistentErrors],
      now
    )
    if (persistentErrors)
      writes[LOCAL_STORAGE_KEYS.persistentErrors] = persistentErrors

    if (LOCAL_STORAGE_KEYS.destinationIssues in stored) {
      writes[LOCAL_STORAGE_KEYS.destinationIssues] =
        DestinationIssuesSchema.parse(
          stored[LOCAL_STORAGE_KEYS.destinationIssues]
        )
    }

    await chrome.storage.local.set(writes)

    const obsoleteKeys = [
      ...(OBSOLETE_COMMAND_RESULTS_KEY in stored
        ? [OBSOLETE_COMMAND_RESULTS_KEY]
        : []),
      ...(LOCAL_STORAGE_KEYS.pendingOutputs in stored
        ? [LOCAL_STORAGE_KEYS.pendingOutputs]
        : []),
      ...(rawLease !== undefined && !currentLease.success
        ? [LOCAL_STORAGE_KEYS.activeDispatchLease]
        : []),
    ]
    if (obsoleteKeys.length > 0) await chrome.storage.local.remove(obsoleteKeys)

    await chrome.storage.local.set({
      [SCHEMA_EPOCH_STORAGE_KEY]: CURRENT_STATE_SCHEMA_EPOCH,
    })
  } catch (error) {
    logger.error("Durable state schema migration failed", error)
    throw error
  }
}
