import { buildTerminalSaveWrites } from "./state-schema-migration-terminal-saves"
import {
  DownloadTaskStateSchema as TerminalTaskSchema,
  PendingUndoActionSchema as TerminalUndoSchema,
} from "./state-schema-migration-terminal-save-schemas"
import { buildTaskDestinationWrites } from "./state-schema-migration-task-destinations"
import {
  DownloadTaskStateSchema as CurrentTaskSchema,
  PendingUndoActionSchema as CurrentUndoSchema,
} from "./state-schema-migration-task-destination-schemas"
import { buildFinalSaveWrites } from "./state-schema-migration-final-saves"
import { parseCurrentNativeOutputState } from "@/src/storage/native-output-repository"
import {
  DownloadTaskStateSchema as CurrentDownloadTaskStateSchema,
  PendingUndoActionSchema as CurrentPendingUndoActionSchema,
} from "./state-schema-migration-final-save-schemas"
import { Epoch5DownloadErrorCategorySchema } from "./state-schema-migration-native-schema"
import { z } from "zod"
import {
  buildSaveEvidenceWrites,
  Epoch5DownloadTaskStateSchema,
  Epoch5PendingUndoActionSchema,
  validateSaveEvidenceHistory,
} from "./state-schema-migration-save-evidence"

import {
  convertStoredTask,
  convertStoredNativeState,
  nativeStorageKeys,
  parseNativeStorageIndex,
  validateNativeOutputMigrationWrites,
} from "./state-schema-migration-output"

import { rebuildSeriesHistory } from "@/src/domain/history/cleanup-policy"
import {
  DownloadedChapterRecordSchema,
  parseHistoryAggregate,
} from "./state-schema-migration-history-schema"
import {
  composeDownloadedChapterKey,
  type DownloadedChapterRecord,
} from "@/src/domain/history/types"
import { isTerminalDownloadTask } from "@/src/domain/queue/task-lifecycle"
import type { DestinationIssueKind } from "./state-schema-migration-destination-issues"
import { createDefaultSettings } from "@/src/domain/settings/defaults"
import {
  parseSettingsDocument,
  SETTINGS_LIMITS,
} from "./state-schema-migration-settings-schema"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import {
  SiteOverrideRecordSchema,
  type SiteOverrideRecord,
} from "@/src/domain/site-integrations/storage-schemas"
import { DestinationIssueSchema } from "./state-schema-migration-destination-issues"
import type { DestinationIssue } from "./state-schema-migration-destination-issues"
import logger from "@/src/runtime/logger"
import { InvalidDurableStateError } from "@/src/runtime/runtime-phase-errors"
import { PersistentErrorsSchema } from "@/src/runtime/persistent-error-schema"
import {
  ActiveDispatchLeaseSchema,
  DownloadTaskStateSchema,
  Epoch2DownloadTaskStateSchema,
  Epoch2PendingUndoActionSchema,
  PendingUndoActionSchema,
  taskSettingsSnapshotSchema,
} from "./state-schema-migration-queue-schemas"
import { SeriesMetadataSnapshotSchema } from "@/src/runtime/series-data-schemas"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { createTaskSettingsSnapshot } from "@/src/runtime/settings-snapshot"
import {
  ARCHIVE_FORMATS,
  CONFLICT_POLICIES,
  DOWNLOAD_DESTINATIONS,
  IMAGE_PADDING_DIGITS,
  LOG_LEVELS,
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
import { assertSafePublicHttpsUrl } from "@/src/site-integrations/request-policy"
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

export const CURRENT_STATE_SCHEMA_EPOCH = 8
type DownloadTaskState = z.infer<typeof DownloadTaskStateSchema>
type PendingUndoAction = z.infer<typeof PendingUndoActionSchema>
const normalizeDownloadErrorCategory = (raw: unknown) =>
  Epoch5DownloadErrorCategorySchema.safeParse(raw).data

const DESTINATION_PAIRING_EPOCH = 3

const SCHEMA_EPOCH_STORAGE_KEY = "stateSchemaEpoch"
const MIGRATION_JOURNAL_STORAGE_KEY = "stateSchemaMigrationJournal"
const LEGACY_DESTINATION_ISSUES_STORAGE_KEY = "destinationIssues"
const OBSOLETE_COMMAND_RESULTS_KEY = "commandResults"
const UPDATE_INTERRUPTION_MESSAGE =
  "Download interrupted by extension update; restart the task to continue"

const DestinationIssuesSchema = z.array(DestinationIssueSchema)
const MigrationJournalSchema = z.strictObject({
  sourceEpoch: z.number().int().nonnegative().nullable(),
  targetEpoch: z.number().int().positive(),
  phase: z.enum(["prepared", "canonical-written", "obsolete-removed"]),
  writes: z.record(z.string(), z.unknown()),
  obsoleteKeys: z.array(z.string().min(1)),
})
type MigrationJournal = z.infer<typeof MigrationJournalSchema>

const MIGRATION_STORAGE_KEYS = [
  SCHEMA_EPOCH_STORAGE_KEY,
  MIGRATION_JOURNAL_STORAGE_KEY,
  ...Object.values(LOCAL_STORAGE_KEYS),
  SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY,
  SITE_INTEGRATION_SETTINGS_STORAGE_KEY,
  SITE_OVERRIDES_STORAGE_KEY,
  LEGACY_DESTINATION_ISSUES_STORAGE_KEY,
  OBSOLETE_COMMAND_RESULTS_KEY,
  nativeStorageKeys.index,
] as const

const MIGRATION_WRITE_KEYS = new Set([
  LOCAL_STORAGE_KEYS.downloadQueue,
  LOCAL_STORAGE_KEYS.pendingUndoActions,
  LOCAL_STORAGE_KEYS.settings,
  LOCAL_STORAGE_KEYS.downloadedChapters,
  LOCAL_STORAGE_KEYS.seriesDownloadHistory,
  LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs,
  LOCAL_STORAGE_KEYS.persistentErrors,
  SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY,
  SITE_INTEGRATION_SETTINGS_STORAGE_KEY,
  SITE_OVERRIDES_STORAGE_KEY,
])
const MIGRATION_OBSOLETE_KEYS = new Set([
  OBSOLETE_COMMAND_RESULTS_KEY,
  LOCAL_STORAGE_KEYS.pendingOutputs,
  LOCAL_STORAGE_KEYS.activeDispatchLease,
  LEGACY_DESTINATION_ISSUES_STORAGE_KEY,
])

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
      : destination === "file-system-access"
        ? DOWNLOAD_ROOT_HANDLE_ID
        : defaults.downloads.customDirectoryHandleId

  const settings: ExtensionSettings = {
    downloads: {
      destination,
      customDirectoryHandleId: handleId,
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
  if (typeof candidate.coverUrl === "string") {
    try {
      candidate.coverUrl = assertSafePublicHttpsUrl(
        candidate.coverUrl,
        "stored cover"
      ).toString()
    } catch {
      delete candidate.coverUrl
    }
  } else if (candidate.coverUrl !== undefined) {
    delete candidate.coverUrl
  }
  delete candidate.title
  return SeriesMetadataSnapshotSchema.safeParse(candidate).data
}

function migrateCoverUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  try {
    return assertSafePublicHttpsUrl(raw, "stored cover").toString()
  } catch {
    return undefined
  }
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
  const baseSnapshot = taskSettingsSnapshotSchema.strip().parse({
    ...createTaskSettingsSnapshot(
      createDefaultSettings("warn"),
      legacy.siteIntegrationId,
      {
        comicInfo: snapshotMetadata(legacy.seriesMetadata),
      }
    ),
    destination: "downloads-api",
  })
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
    seriesCoverUrl: migrateCoverUrl(legacy.seriesCoverUrl),
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
    destinationIssue:
      legacy.activeBlock === "destination_action_required"
        ? {
            id: `${legacy.id}:${legacy.chapters.find((chapter) => chapter.status === "queued" || chapter.status === "downloading")?.id ?? ""}:${destinationIssueKindForErrorCategory(legacy.errorCategory)}`,
            taskId: legacy.id,
            chapterId: legacy.chapters.find(
              (chapter) =>
                chapter.status === "queued" || chapter.status === "downloading"
            )?.id,
            kind: destinationIssueKindForErrorCategory(legacy.errorCategory),
            occurredAt: legacy.started ?? legacy.created,
          }
        : undefined,
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

function migrateEpoch2DownloadTask(raw: unknown): DownloadTaskState {
  const parsed = Epoch2DownloadTaskStateSchema.parse(convertStoredTask(raw))
  const candidate = {
    ...parsed,
    seriesCoverUrl: migrateCoverUrl(parsed.seriesCoverUrl),
    settingsSnapshot: {
      ...parsed.settingsSnapshot,
      comicInfo: snapshotMetadata(parsed.settingsSnapshot.comicInfo),
    },
  } as unknown as DownloadTaskState
  return DownloadTaskStateSchema.parse(normalizeDestinationIssuePair(candidate))
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

function migrateEpoch2Queue(raw: unknown): DownloadTaskState[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw))
    throw new Error("Stored download queue is not an array")
  const queue = raw.map(migrateEpoch2DownloadTask)
  if (new Set(queue.map((task) => task.id)).size !== queue.length) {
    throw new Error("Stored download queue contains duplicate task IDs")
  }
  return queue
}

function migrateDestinationIssues(raw: unknown): DestinationIssue[] {
  if (raw === undefined) return []
  const parsed = DestinationIssuesSchema.safeParse(raw)
  if (!parsed.success) {
    logger.warn("[Migration] Dropped malformed destination issue document")
    return []
  }
  const issues = parsed.data
  const latestByTask = new Map<string, DestinationIssue>()
  for (const issue of issues) {
    const existing = latestByTask.get(issue.taskId)
    if (!existing || issue.occurredAt >= existing.occurredAt) {
      latestByTask.set(issue.taskId, issue)
    }
  }
  return [...latestByTask.values()]
}

function destinationIssueKindForErrorCategory(
  errorCategory: unknown
): DestinationIssueKind {
  switch (errorCategory) {
    case "folder_permission_required":
      return "fsa_permission_required"
    case "folder_write_failed":
      return "fsa_write_failed"
    case "disk_full":
      return "disk_full"
    case "folder_unavailable":
      return "fsa_folder_missing"
    default:
      return "fsa_folder_missing"
  }
}

function destinationIssueKindForTask(
  task: DownloadTaskState
): DestinationIssueKind {
  return destinationIssueKindForErrorCategory(task.errorCategory)
}

function synthesizeDestinationIssue(task: DownloadTaskState): DestinationIssue {
  const chapterId = task.chapters.find(
    (chapter) => chapter.status === "queued" || chapter.status === "downloading"
  )?.id
  const kind = destinationIssueKindForTask(task)
  return {
    id: `${task.id}:${chapterId ?? ""}:${kind}`,
    taskId: task.id,
    chapterId,
    kind,
    occurredAt: task.started ?? task.created,
  }
}

function normalizeDestinationIssuePair(
  task: DownloadTaskState,
  migratedIssue?: DestinationIssue
): DownloadTaskState {
  if (isTerminalDownloadTask(task)) {
    return {
      ...task,
      activeBlock: undefined,
      destinationIssue: undefined,
    }
  }
  if (task.activeBlock !== "destination_action_required") {
    return { ...task, destinationIssue: undefined }
  }
  const issue = migratedIssue ?? task.destinationIssue
  const validIssue =
    issue &&
    issue.taskId === task.id &&
    (issue.chapterId === undefined ||
      task.chapters.some((chapter) => chapter.id === issue.chapterId))
  return {
    ...task,
    status: "queued",
    chapters: task.chapters.map((chapter) =>
      chapter.status === "downloading"
        ? { ...chapter, status: "queued" as const }
        : chapter
    ),
    destinationIssue: validIssue ? issue : synthesizeDestinationIssue(task),
  }
}

function attachDestinationIssues(
  queue: DownloadTaskState[],
  pendingUndoActions: PendingUndoAction[],
  raw: unknown
): {
  queue: DownloadTaskState[]
  pendingUndoActions: PendingUndoAction[]
} {
  const issues = migrateDestinationIssues(raw)
  const issueByTask = new Map(issues.map((issue) => [issue.taskId, issue]))
  return {
    queue: queue.map((task) =>
      normalizeDestinationIssuePair(task, issueByTask.get(task.id))
    ),
    pendingUndoActions: pendingUndoActions.map((action) => {
      const issue = issueByTask.get(action.taskSnapshot.id)
      return {
        ...action,
        taskSnapshot: normalizeDestinationIssuePair(action.taskSnapshot, issue),
      }
    }),
  }
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

function migrateEpoch2PendingUndoActions(raw: unknown): PendingUndoAction[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw))
    throw new Error("Stored pending Undo actions are not an array")
  return raw.map((value) => {
    const action = Epoch2PendingUndoActionSchema.parse(convertStoredUndo(value))
    return PendingUndoActionSchema.parse({
      ...action,
      taskSnapshot: migrateEpoch2DownloadTask(action.taskSnapshot),
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

function normalizeRetainedInterruptedTask(
  task: DownloadTaskState,
  now: number
): DownloadTaskState {
  const chapters = task.chapters.map((chapter) => {
    if (chapter.status !== "downloading" && chapter.status !== "queued")
      return chapter
    const requested = Math.max(0, chapter.outputs?.requested ?? 0)
    const committed = Math.max(0, chapter.outputs?.committed ?? 0)
    const failed = Math.max(
      0,
      chapter.outputs?.failed ?? 0,
      requested - committed
    )
    const complete =
      chapter.status === "downloading" &&
      requested > 0 &&
      committed === requested &&
      failed === 0
    return {
      ...chapter,
      status: complete
        ? ("completed" as const)
        : chapter.status === "downloading" && committed > 0
          ? ("partial_success" as const)
          : ("failed" as const),
      errorMessage: complete ? undefined : UPDATE_INTERRUPTION_MESSAGE,
      errorCategory: complete ? undefined : ("unknown" as const),
      ...(chapter.status === "downloading" && committed > 0
        ? { outputs: { requested, committed, failed } }
        : {}),
      lastUpdated: now,
    }
  })
  const allCompleted =
    chapters.length > 0 &&
    chapters.every((chapter) => chapter.status === "completed")
  const firstFailure = chapters.find(
    (chapter) =>
      chapter.status === "failed" || chapter.status === "partial_success"
  )
  return {
    ...task,
    chapters,
    status: allCompleted
      ? "completed"
      : chapters.some(
            (chapter) =>
              chapter.status === "completed" ||
              chapter.status === "partial_success"
          )
        ? "partial_success"
        : "failed",
    activeBlock: undefined,
    destinationIssue: undefined,
    errorMessage: allCompleted
      ? undefined
      : (firstFailure?.errorMessage ?? UPDATE_INTERRUPTION_MESSAGE),
    errorCategory: allCompleted
      ? undefined
      : (firstFailure?.errorCategory ?? "unknown"),
    completed: task.completed ?? now,
  }
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

function readSupportedEpoch(raw: unknown): number | null {
  if (raw === undefined) return null
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
    throw new Error("Stored state schema epoch is invalid")
  }
  if (raw > CURRENT_STATE_SCHEMA_EPOCH) {
    throw new Error(
      `Stored state schema epoch ${raw} is newer than supported epoch ${CURRENT_STATE_SCHEMA_EPOCH}`
    )
  }
  return raw
}

function validateMigrationJournal(journal: MigrationJournal): void {
  if (
    !MIGRATION_STEPS.some((step) => step.targetEpoch === journal.targetEpoch)
  ) {
    throw new Error("State migration journal has an unsupported target epoch")
  }
  for (const key of [
    LOCAL_STORAGE_KEYS.downloadQueue,
    LOCAL_STORAGE_KEYS.pendingUndoActions,
  ]) {
    if (!Object.hasOwn(journal.writes, key)) {
      throw new Error(
        `State migration journal is missing canonical write key: ${key}`
      )
    }
  }
  for (const key of Object.keys(journal.writes)) {
    if (
      !MIGRATION_WRITE_KEYS.has(key) &&
      !(
        (journal.targetEpoch === 4 || journal.targetEpoch === 7) &&
        (key === nativeStorageKeys.index ||
          key.startsWith(nativeStorageKeys.manifestPrefix) ||
          key.startsWith(nativeStorageKeys.outputPrefix))
      )
    ) {
      throw new Error(
        `State migration journal contains an invalid write key: ${key}`
      )
    }
  }
  const seenObsoleteKeys = new Set<string>()
  for (const key of journal.obsoleteKeys) {
    if (!MIGRATION_OBSOLETE_KEYS.has(key)) {
      throw new Error(
        `State migration journal contains an invalid obsolete key: ${key}`
      )
    }
    if (seenObsoleteKeys.has(key)) {
      throw new Error(
        `State migration journal contains a duplicate obsolete key: ${key}`
      )
    }
    seenObsoleteKeys.add(key)
  }

  if (Object.hasOwn(journal.writes, LOCAL_STORAGE_KEYS.downloadQueue)) {
    z.array(
      journal.targetEpoch === 8
        ? TerminalTaskSchema
        : journal.targetEpoch === 7
          ? CurrentDownloadTaskStateSchema
          : journal.targetEpoch === 6
            ? CurrentTaskSchema
            : journal.targetEpoch === 5
              ? Epoch5DownloadTaskStateSchema
              : DownloadTaskStateSchema
    ).parse(
      journal.targetEpoch === 3
        ? (journal.writes[LOCAL_STORAGE_KEYS.downloadQueue] as unknown[]).map(
            convertStoredTask
          )
        : journal.writes[LOCAL_STORAGE_KEYS.downloadQueue]
    )
  }
  if (Object.hasOwn(journal.writes, LOCAL_STORAGE_KEYS.pendingUndoActions)) {
    z.array(
      journal.targetEpoch === 8
        ? TerminalUndoSchema
        : journal.targetEpoch === 7
          ? CurrentPendingUndoActionSchema
          : journal.targetEpoch === 6
            ? CurrentUndoSchema
            : journal.targetEpoch === 5
              ? Epoch5PendingUndoActionSchema
              : PendingUndoActionSchema
    ).parse(
      journal.targetEpoch === 3
        ? (
            journal.writes[LOCAL_STORAGE_KEYS.pendingUndoActions] as unknown[]
          ).map(convertStoredUndo)
        : journal.writes[LOCAL_STORAGE_KEYS.pendingUndoActions]
    )
  }
  if (Object.hasOwn(journal.writes, LOCAL_STORAGE_KEYS.settings)) {
    parseSettingsDocument(journal.writes[LOCAL_STORAGE_KEYS.settings])
  }
  if (Object.hasOwn(journal.writes, SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY)) {
    parseSiteIntegrationEnablementDocument(
      journal.writes[SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY]
    )
  }
  if (Object.hasOwn(journal.writes, SITE_INTEGRATION_SETTINGS_STORAGE_KEY)) {
    parseSiteIntegrationSettingsDocument(
      journal.writes[SITE_INTEGRATION_SETTINGS_STORAGE_KEY]
    )
  }
  if (Object.hasOwn(journal.writes, SITE_OVERRIDES_STORAGE_KEY)) {
    parseSiteOverridesDocument(journal.writes[SITE_OVERRIDES_STORAGE_KEY])
  }
  if (Object.hasOwn(journal.writes, LOCAL_STORAGE_KEYS.persistentErrors)) {
    PersistentErrorsSchema.parse(
      journal.writes[LOCAL_STORAGE_KEYS.persistentErrors]
    )
  }

  const nativeKeys = Object.keys(journal.writes).filter((key) =>
    key.startsWith("pendingOutputs:")
  )
  if (nativeKeys.length > 0) {
    if (!Object.hasOwn(journal.writes, nativeStorageKeys.index))
      throw new Error(
        "State migration journal is missing the native output index"
      )
    validateNativeOutputMigrationWrites(
      journal.writes,
      journal.targetEpoch === 7 ? parseCurrentNativeOutputState : undefined
    )
  }

  const historyKeys = [
    LOCAL_STORAGE_KEYS.downloadedChapters,
    LOCAL_STORAGE_KEYS.seriesDownloadHistory,
    LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs,
  ]
  const presentHistoryKeys = historyKeys.filter((key) =>
    Object.hasOwn(journal.writes, key)
  )
  if (presentHistoryKeys.length > 0) {
    if (presentHistoryKeys.length !== historyKeys.length) {
      throw new Error(
        "State migration journal contains a partial history aggregate"
      )
    }
    const validateHistory =
      journal.targetEpoch >= 5
        ? validateSaveEvidenceHistory
        : parseHistoryAggregate
    validateHistory({
      downloadedChapters: journal.writes[LOCAL_STORAGE_KEYS.downloadedChapters],
      seriesDownloadHistory:
        journal.writes[LOCAL_STORAGE_KEYS.seriesDownloadHistory],
      clearCutoffs:
        journal.writes[LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs],
    })
  }
}

function buildDestinationPairingJournal(
  stored: Record<string, unknown>,
  sourceEpoch: number | null
): MigrationJournal {
  const now = Date.now()
  const isReleasedEpoch2 = sourceEpoch === 2
  let queue = isReleasedEpoch2
    ? migrateEpoch2Queue(stored[LOCAL_STORAGE_KEYS.downloadQueue])
    : migrateQueue(stored[LOCAL_STORAGE_KEYS.downloadQueue])
  let pendingUndoActions = isReleasedEpoch2
    ? migrateEpoch2PendingUndoActions(
        stored[LOCAL_STORAGE_KEYS.pendingUndoActions]
      )
    : migratePendingUndoActions(stored[LOCAL_STORAGE_KEYS.pendingUndoActions])
  const destinationState = attachDestinationIssues(
    queue,
    pendingUndoActions,
    stored[LEGACY_DESTINATION_ISSUES_STORAGE_KEY]
  )
  queue = destinationState.queue
  pendingUndoActions = destinationState.pendingUndoActions

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
        ? normalizeRetainedInterruptedTask(task, now)
        : task
    )
  }

  const writes: Record<string, unknown> = {
    [LOCAL_STORAGE_KEYS.downloadQueue]: queue,
    [LOCAL_STORAGE_KEYS.pendingUndoActions]: pendingUndoActions,
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
  if (siteSettings) writes[SITE_INTEGRATION_SETTINGS_STORAGE_KEY] = siteSettings

  const siteOverrides = migrateSiteOverrides(stored[SITE_OVERRIDES_STORAGE_KEY])
  if (siteOverrides) writes[SITE_OVERRIDES_STORAGE_KEY] = siteOverrides

  const persistentErrors = migratePersistentErrors(
    stored[LOCAL_STORAGE_KEYS.persistentErrors],
    now
  )
  if (persistentErrors)
    writes[LOCAL_STORAGE_KEYS.persistentErrors] = persistentErrors

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
    ...(LEGACY_DESTINATION_ISSUES_STORAGE_KEY in stored
      ? [LEGACY_DESTINATION_ISSUES_STORAGE_KEY]
      : []),
  ]

  const journal = MigrationJournalSchema.parse({
    sourceEpoch,
    targetEpoch: DESTINATION_PAIRING_EPOCH,
    phase: "prepared",
    writes,
    obsoleteKeys,
  })
  validateMigrationJournal(journal)
  return journal
}

function convertStoredUndo(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  return { ...raw, taskSnapshot: convertStoredTask(raw.taskSnapshot) }
}

function buildOutputMigrationJournal(
  stored: Record<string, unknown>,
  sourceEpoch: number | null
): MigrationJournal {
  const queue =
    stored[LOCAL_STORAGE_KEYS.downloadQueue] === undefined
      ? []
      : stored[LOCAL_STORAGE_KEYS.downloadQueue]
  const undo =
    stored[LOCAL_STORAGE_KEYS.pendingUndoActions] === undefined
      ? []
      : stored[LOCAL_STORAGE_KEYS.pendingUndoActions]
  if (!Array.isArray(queue) || !Array.isArray(undo)) {
    throw new Error("Stored queue and Undo documents must be arrays")
  }
  const writes: Record<string, unknown> = {
    [LOCAL_STORAGE_KEYS.downloadQueue]: z
      .array(DownloadTaskStateSchema)
      .parse(queue.map(convertStoredTask)),
    [LOCAL_STORAGE_KEYS.pendingUndoActions]: z
      .array(PendingUndoActionSchema)
      .parse(undo.map(convertStoredUndo)),
    ...convertStoredNativeState(stored),
  }
  const journal = MigrationJournalSchema.parse({
    sourceEpoch,
    targetEpoch: 4,
    phase: "prepared",
    writes,
    obsoleteKeys: [],
  })
  validateMigrationJournal(journal)
  return journal
}

function buildHistoryEvidenceJournal(
  stored: Record<string, unknown>,
  sourceEpoch: number | null
): MigrationJournal {
  const journal = MigrationJournalSchema.parse({
    sourceEpoch,
    targetEpoch: 5,
    phase: "prepared",
    writes: buildSaveEvidenceWrites(stored),
    obsoleteKeys: [],
  })
  validateMigrationJournal(journal)
  return journal
}

const MIGRATION_STEPS = [
  {
    targetEpoch: DESTINATION_PAIRING_EPOCH,
    prepare: buildDestinationPairingJournal,
  },
  { targetEpoch: 4, prepare: buildOutputMigrationJournal },
  { targetEpoch: 5, prepare: buildHistoryEvidenceJournal },
  {
    targetEpoch: 6,
    prepare: (
      stored: Record<string, unknown>,
      sourceEpoch: number | null
    ): MigrationJournal => {
      const journal = MigrationJournalSchema.parse({
        sourceEpoch,
        targetEpoch: 6,
        phase: "prepared",
        writes: buildTaskDestinationWrites(stored),
        obsoleteKeys: [],
      })
      validateMigrationJournal(journal)
      return journal
    },
  },
  {
    targetEpoch: 7,
    prepare: (
      stored: Record<string, unknown>,
      sourceEpoch: number | null
    ): MigrationJournal => {
      const journal = MigrationJournalSchema.parse({
        sourceEpoch,
        targetEpoch: 7,
        phase: "prepared",
        writes: buildFinalSaveWrites(stored),
        obsoleteKeys: [],
      })
      validateMigrationJournal(journal)
      return journal
    },
  },
  {
    targetEpoch: 8,
    prepare: (
      stored: Record<string, unknown>,
      sourceEpoch: number | null
    ): MigrationJournal => {
      const journal = MigrationJournalSchema.parse({
        sourceEpoch,
        targetEpoch: 8,
        phase: "prepared",
        writes: buildTerminalSaveWrites(stored),
        obsoleteKeys: [],
      })
      validateMigrationJournal(journal)
      return journal
    },
  },
] as const

function parseMigrationJournal(raw: unknown): MigrationJournal | null {
  if (raw === undefined) return null
  const parsed = MigrationJournalSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error("Stored state schema migration journal is invalid")
  }
  if (
    (parsed.data.sourceEpoch !== null &&
      parsed.data.sourceEpoch >= parsed.data.targetEpoch) ||
    (parsed.data.targetEpoch >= 4 &&
      parsed.data.sourceEpoch !== parsed.data.targetEpoch - 1)
  ) {
    throw new Error(
      "Stored state schema migration journal has an invalid source epoch"
    )
  }
  validateMigrationJournal(parsed.data)
  return parsed.data
}

function validateMigrationJournalAgainstStoredState(
  journal: MigrationJournal,
  stored: Record<string, unknown>,
  epoch: number | null
): void {
  if (epoch === journal.targetEpoch) return
  if (journal.sourceEpoch !== epoch) {
    throw new Error(
      "State migration journal source epoch does not match stored epoch"
    )
  }
  if (journal.targetEpoch !== DESTINATION_PAIRING_EPOCH) return
  for (const key of MIGRATION_OBSOLETE_KEYS) {
    const presentAndObsolete =
      key === LOCAL_STORAGE_KEYS.activeDispatchLease
        ? key in stored &&
          !ActiveDispatchLeaseSchema.safeParse(stored[key]).success
        : key in stored
    if (presentAndObsolete && !journal.obsoleteKeys.includes(key)) {
      throw new Error(
        `State migration journal does not remove obsolete key: ${key}`
      )
    }
  }
}

async function persistMigrationJournal(
  journal: MigrationJournal
): Promise<void> {
  validateMigrationJournal(journal)
  await chrome.storage.local.set({
    [MIGRATION_JOURNAL_STORAGE_KEY]: journal,
  })
}

async function replayMigrationJournal(
  journal: MigrationJournal
): Promise<void> {
  let current = journal
  if (current.phase === "prepared") {
    await chrome.storage.local.set(current.writes)
    current = { ...current, phase: "canonical-written" }
    await persistMigrationJournal(current)
  }
  if (current.phase === "canonical-written") {
    if (current.obsoleteKeys.length > 0) {
      await chrome.storage.local.remove(current.obsoleteKeys)
    }
    current = { ...current, phase: "obsolete-removed" }
    await persistMigrationJournal(current)
  }
  await chrome.storage.local.set({
    [SCHEMA_EPOCH_STORAGE_KEY]: current.targetEpoch,
  })
  await chrome.storage.local.remove(MIGRATION_JOURNAL_STORAGE_KEY)
}

/**
 * Migrates supported released documents before repository hydration. The
 * journal stores the canonical write set and its phase, so every interrupted
 * phase can be replayed without reading partially migrated documents.
 */
export async function migrateDurableStateForCurrentSchema(): Promise<void> {
  try {
    let stored = await chrome.storage.local.get([...MIGRATION_STORAGE_KEYS])
    while (true) {
      if (
        (stored[SCHEMA_EPOCH_STORAGE_KEY] === 3 ||
          stored[SCHEMA_EPOCH_STORAGE_KEY] === 4 ||
          stored[SCHEMA_EPOCH_STORAGE_KEY] === 5 ||
          stored[SCHEMA_EPOCH_STORAGE_KEY] === 6) &&
        stored[MIGRATION_JOURNAL_STORAGE_KEY] === undefined
      ) {
        let index
        try {
          index = parseNativeStorageIndex(stored[nativeStorageKeys.index])
        } catch (cause) {
          throw new InvalidDurableStateError(
            "Invalid durable native output index",
            { cause }
          )
        }
        const keys = [
          ...index.jobIds.map((id) => nativeStorageKeys.manifestPrefix + id),
          ...index.outputIds.map((id) => nativeStorageKeys.outputPrefix + id),
        ]
        if (keys.length > 0)
          Object.assign(stored, await chrome.storage.local.get(keys))
      }
      let plan: MigrationJournal
      let existingJournal: MigrationJournal | null
      try {
        const epoch = readSupportedEpoch(stored[SCHEMA_EPOCH_STORAGE_KEY])
        existingJournal = parseMigrationJournal(
          stored[MIGRATION_JOURNAL_STORAGE_KEY]
        )
        if (existingJournal) {
          validateMigrationJournalAgainstStoredState(
            existingJournal,
            stored,
            epoch
          )
          if (
            epoch === existingJournal.targetEpoch &&
            existingJournal.phase !== "obsolete-removed"
          ) {
            throw new Error(
              "State migration journal phase is inconsistent with the current epoch"
            )
          }
        }
        if (epoch === CURRENT_STATE_SCHEMA_EPOCH && existingJournal === null)
          return
        const step = MIGRATION_STEPS.find(
          (candidate) => candidate.targetEpoch > (epoch ?? -1)
        )
        if (!existingJournal && !step)
          throw new Error("No supported state migration step")
        plan = existingJournal ?? step!.prepare(stored, epoch)
      } catch (cause) {
        throw new InvalidDurableStateError(
          cause instanceof Error ? cause.message : "Invalid retained state",
          { cause }
        )
      }
      if (existingJournal === null) await persistMigrationJournal(plan)
      logger.info(
        `[Init] Migrating durable state schema from ${String(plan.sourceEpoch)} to ${plan.targetEpoch}`
      )
      await replayMigrationJournal(plan)
      stored = await chrome.storage.local.get([...MIGRATION_STORAGE_KEYS])
    }
  } catch (error) {
    logger.error("Durable state schema migration failed", error)
    throw error
  }
}
