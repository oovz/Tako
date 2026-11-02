import {
  boundedInteger,
  canonicalizeSettings,
} from "./state-schema-migration-settings"
import { parseSettingsDocument as parseCurrentSettingsDocument } from "@/src/domain/settings/schema"
import {
  DownloadTaskStateSchema as FallbackTaskSchema,
  PendingUndoActionSchema as FallbackUndoSchema,
} from "./queue-state-schemas"
import { buildTerminalSaveWrites } from "./state-schema-migration-terminal-saves"
import {
  buildIntegrationIdWrites,
  currentIntegrationMapForValidation,
  getHistoricalIntegrationDefinition,
} from "./state-schema-migration-integration-ids"
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
import { ARCHIVE_FORMATS } from "@/src/shared/download-contract"
import {
  LegacyTaskSettingsSnapshotSchema,
  LegacyDownloadTaskSchema,
  LegacyPendingUndoActionSchema,
  LegacyDownloadedChapterSchema,
  LegacyHistoryCutoffsSchema,
} from "./state-schema-migration-legacy-schemas"
import { RATE_POLICY_LIMITS } from "@/src/shared/rate-policy-limits"
import { isRecord } from "@/src/shared/type-guards"
import { assertValidSettingsFieldValue } from "@/src/site-integrations/catalog"
import { assertSafePublicHttpsUrl } from "@/src/site-integrations/request-policy"
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

export const CURRENT_STATE_SCHEMA_EPOCH = 10
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

type LegacyTask = z.infer<typeof LegacyDownloadTaskSchema>
type LegacySnapshot = z.infer<typeof LegacyTaskSettingsSnapshotSchema>
type TaskSnapshot = DownloadTaskState["settingsSnapshot"]

function readLegacyTaskSnapshot(legacy: LegacyTask): LegacySnapshot {
  const raw = isRecord(legacy.settingsSnapshot)
    ? legacy.settingsSnapshot
    : isRecord(legacy.taskSettingsSnapshot)
      ? legacy.taskSettingsSnapshot
      : undefined
  return raw ? LegacyTaskSettingsSnapshotSchema.parse(raw) : {}
}

function legacySnapshotConflictPolicy(snapshot: LegacySnapshot) {
  if (snapshot.conflictPolicy !== undefined) return snapshot.conflictPolicy
  if (snapshot.destination === "file-system-access")
    return snapshot.fsaCollisionPolicy === "overwrite"
      ? "overwrite"
      : "uniquify"
  return snapshot.overwriteExisting ? "overwrite" : "uniquify"
}

function legacySnapshotArchiveSettings(
  snapshot: LegacySnapshot,
  base: TaskSnapshot
) {
  return {
    archiveFormat: snapshot.archiveFormat ?? base.archiveFormat,
    destination: snapshot.destination ?? "downloads-api",
    conflictPolicy: legacySnapshotConflictPolicy(snapshot),
    pathTemplate: snapshot.pathTemplate ?? base.pathTemplate,
    fileNameTemplate: snapshot.fileNameTemplate ?? base.fileNameTemplate,
    includeComicInfo: snapshot.includeComicInfo ?? base.includeComicInfo,
    includeCoverImage: snapshot.includeCoverImage ?? base.includeCoverImage,
  }
}

function legacySnapshotImageSettings(
  snapshot: LegacySnapshot,
  base: TaskSnapshot
) {
  return {
    siteSettings: snapshot.siteSettings ?? base.siteSettings,
    normalizeImageFilenames:
      snapshot.normalizeImageFilenames ?? base.normalizeImageFilenames,
    imagePaddingDigits: snapshot.imagePaddingDigits ?? base.imagePaddingDigits,
    comicInfo: snapshotMetadata(snapshot.comicInfo) ?? base.comicInfo,
  }
}

function legacySnapshotRatePolicy(
  snapshot: LegacySnapshot,
  base: TaskSnapshot
): TaskSnapshot["rateLimitSettings"] {
  const policy = snapshot.rateLimitSettings ?? {}
  const image = policy.image ?? {}
  const chapter = policy.chapter ?? {}
  return {
    image: {
      concurrency: boundedInteger(
        image.concurrency,
        base.rateLimitSettings.image.concurrency,
        RATE_POLICY_LIMITS.MIN_CONCURRENCY,
        RATE_POLICY_LIMITS.MAX_CONCURRENCY
      ),
      delayMs: boundedInteger(
        image.delayMs,
        base.rateLimitSettings.image.delayMs,
        RATE_POLICY_LIMITS.MIN_DELAY_MS,
        RATE_POLICY_LIMITS.MAX_DELAY_MS
      ),
    },
    chapter: {
      concurrency: 1,
      delayMs: boundedInteger(
        chapter.delayMs,
        base.rateLimitSettings.chapter.delayMs,
        RATE_POLICY_LIMITS.MIN_DELAY_MS,
        RATE_POLICY_LIMITS.MAX_DELAY_MS
      ),
    },
  }
}

function legacySnapshotRetries(snapshot: LegacySnapshot, base: TaskSnapshot) {
  const retries = snapshot.retrySettings ?? {}
  return {
    image: boundedInteger(
      retries.image,
      base.retrySettings.image,
      SETTINGS_LIMITS.MIN_RETRIES,
      SETTINGS_LIMITS.MAX_RETRIES
    ),
    chapter: boundedInteger(
      retries.chapter,
      base.retrySettings.chapter,
      SETTINGS_LIMITS.MIN_RETRIES,
      SETTINGS_LIMITS.MAX_RETRIES
    ),
  }
}

function migrateLegacyTaskSnapshot(legacy: LegacyTask): TaskSnapshot {
  const snapshot = readLegacyTaskSnapshot(legacy)
  const base = taskSettingsSnapshotSchema.strip().parse({
    ...createTaskSettingsSnapshot(
      createDefaultSettings("warn"),
      legacy.siteIntegrationId,
      {
        comicInfo: snapshotMetadata(legacy.seriesMetadata),
      }
    ),
    destination: "downloads-api",
  })
  return {
    ...base,
    ...legacySnapshotArchiveSettings(snapshot, base),
    ...legacySnapshotImageSettings(snapshot, base),
    rateLimitSettings: legacySnapshotRatePolicy(snapshot, base),
    retrySettings: legacySnapshotRetries(snapshot, base),
    siteIntegrationId: legacy.siteIntegrationId,
  }
}

function optionalImageCount(value: number | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined
}

function migrateLegacyChapter(chapter: LegacyTask["chapters"][number]) {
  const outputs = chapter.outputs ?? {}
  return {
    ...chapter,
    locked: chapter.locked === true,
    errorCategory: normalizeDownloadErrorCategory(chapter.errorCategory),
    totalImages: optionalImageCount(chapter.totalImages),
    imagesFailed: optionalImageCount(chapter.imagesFailed),
    outputs: {
      requested: outputs.requested ?? 0,
      committed: outputs.committed ?? 0,
      failed: outputs.failed ?? 0,
    },
  }
}

function migrateDownloadTask(raw: unknown): DownloadTaskState {
  const current = DownloadTaskStateSchema.safeParse(raw)
  if (current.success) return current.data
  const legacy = LegacyDownloadTaskSchema.parse(raw)
  return DownloadTaskStateSchema.parse({
    id: legacy.id,
    siteIntegrationId: legacy.siteIntegrationId,
    mangaId: legacy.mangaId,
    seriesTitle: legacy.seriesTitle,
    seriesCoverUrl: migrateCoverUrl(legacy.seriesCoverUrl),
    chapters: legacy.chapters.map(migrateLegacyChapter),
    status: legacy.status,
    errorMessage: legacy.errorMessage,
    errorCategory: normalizeDownloadErrorCategory(legacy.errorCategory),
    activeBlock: legacy.activeBlock,
    destinationIssue:
      legacy.activeBlock === "destination_action_required"
        ? synthesizeDestinationIssue(legacy)
        : undefined,
    destinationOverride: legacy.destinationOverride,
    created: legacy.created,
    started: legacy.started,
    completed: legacy.completed,
    isRetried: legacy.isRetried === true,
    isRetryTask: legacy.isRetryTask === true,
    lastSuccessfulDownloadId: legacy.lastSuccessfulDownloadId,
    nextChapterDispatchAt: legacy.nextChapterDispatchAt,
    settingsSnapshot: migrateLegacyTaskSnapshot(legacy),
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

function migrateQueue(
  raw: unknown,
  migrateTask: (raw: unknown) => DownloadTaskState = migrateDownloadTask
): DownloadTaskState[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw))
    throw new Error("Stored download queue is not an array")
  const queue = raw.map(migrateTask)
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

const LEGACY_DESTINATION_ISSUE_KINDS = new Map<unknown, DestinationIssueKind>([
  ["folder_permission_required", "fsa_permission_required"],
  ["folder_write_failed", "fsa_write_failed"],
  ["disk_full", "disk_full"],
  ["folder_unavailable", "fsa_folder_missing"],
])

function destinationIssueKindForErrorCategory(
  errorCategory: unknown
): DestinationIssueKind {
  return (
    LEGACY_DESTINATION_ISSUE_KINDS.get(errorCategory) ?? "fsa_folder_missing"
  )
}

function synthesizeDestinationIssue(task: {
  id: string
  chapters: { id: string; status: string }[]
  errorCategory?: unknown
  started?: number
  created: number
}): DestinationIssue {
  const chapterId = task.chapters.find(
    (chapter) => chapter.status === "queued" || chapter.status === "downloading"
  )?.id
  const kind = destinationIssueKindForErrorCategory(task.errorCategory)
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

function readLegacyHistoryRecords(
  stored: Record<string, unknown>
): DownloadedChapterRecord[] {
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

  return records
}

function latestHistoryRecords(
  records: DownloadedChapterRecord[]
): DownloadedChapterRecord[] {
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
  return [...byChapter.values()]
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

  const downloadedChapters = latestHistoryRecords(
    readLegacyHistoryRecords(stored)
  )

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
    if (
      !getHistoricalIntegrationDefinition(siteIntegrationId) ||
      typeof enabled !== "boolean"
    ) {
      warnDroppedProviderEntry("enablement", siteIntegrationId)
      continue
    }
    migrated[siteIntegrationId] = enabled
  }
  parseSiteIntegrationEnablementDocument(
    currentIntegrationMapForValidation(migrated)
  )
  return migrated
}

function migrateSiteSettings(
  raw: unknown
): Record<string, Record<string, unknown>> | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw))
    throw new Error("Stored site-integration settings are not an object")
  const migrated: Record<string, Record<string, unknown>> = {}
  for (const [siteIntegrationId, settings] of Object.entries(raw)) {
    const definition = getHistoricalIntegrationDefinition(siteIntegrationId)
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
  parseSiteIntegrationSettingsDocument(
    currentIntegrationMapForValidation(migrated)
  )
  return migrated
}

function optionalBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number
) {
  return typeof value === "number"
    ? boundedInteger(value, minimum, minimum, maximum)
    : undefined
}

function migrateSiteOverride(
  override: Record<string, unknown>
): SiteOverrideRecord {
  const image = isRecord(override.imagePolicy) ? override.imagePolicy : {}
  const chapter = isRecord(override.chapterPolicy) ? override.chapterPolicy : {}
  const retries = isRecord(override.retries) ? override.retries : {}
  return SiteOverrideRecordSchema.parse({
    outputFormat: ARCHIVE_FORMATS.find(
      (format) => format === override.outputFormat
    ),
    pathTemplate:
      typeof override.pathTemplate === "string"
        ? override.pathTemplate
        : undefined,
    imagePolicy: {
      concurrency: optionalBoundedInteger(
        image.concurrency,
        RATE_POLICY_LIMITS.MIN_CONCURRENCY,
        RATE_POLICY_LIMITS.MAX_CONCURRENCY
      ),
      delayMs: optionalBoundedInteger(
        image.delayMs,
        RATE_POLICY_LIMITS.MIN_DELAY_MS,
        RATE_POLICY_LIMITS.MAX_DELAY_MS
      ),
    },
    chapterPolicy: {
      delayMs: optionalBoundedInteger(
        chapter.delayMs,
        RATE_POLICY_LIMITS.MIN_DELAY_MS,
        RATE_POLICY_LIMITS.MAX_DELAY_MS
      ),
    },
    retries: {
      image: optionalBoundedInteger(
        retries.image,
        SETTINGS_LIMITS.MIN_RETRIES,
        SETTINGS_LIMITS.MAX_RETRIES
      ),
      chapter: optionalBoundedInteger(
        retries.chapter,
        SETTINGS_LIMITS.MIN_RETRIES,
        SETTINGS_LIMITS.MAX_RETRIES
      ),
    },
  })
}

function migrateSiteOverrides(
  raw: unknown
): Record<string, SiteOverrideRecord> | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) throw new Error("Stored site overrides are not an object")
  const migrated: Record<string, SiteOverrideRecord> = {}
  for (const [siteIntegrationId, override] of Object.entries(raw)) {
    if (
      !getHistoricalIntegrationDefinition(siteIntegrationId) ||
      !isRecord(override)
    ) {
      warnDroppedProviderEntry("overrides", siteIntegrationId)
      continue
    }
    migrated[siteIntegrationId] = migrateSiteOverride(override)
  }
  parseSiteOverridesDocument(currentIntegrationMapForValidation(migrated))
  return migrated
}

function persistentErrorTimestamp(value: unknown, now: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : now
}

function migratePersistentError(value: unknown, now: number) {
  if (
    !isRecord(value) ||
    typeof value.code !== "string" ||
    value.code.length === 0 ||
    typeof value.message !== "string"
  )
    return []
  return [
    {
      code: value.code,
      message: value.message,
      severity: value.severity === "error" ? "error" : "warning",
      ts: persistentErrorTimestamp(value.ts, now),
    },
  ]
}

function migratePersistentErrors(raw: unknown, now: number): unknown {
  if (raw === undefined) return undefined
  const current = PersistentErrorsSchema.safeParse(raw)
  if (current.success) return current.data
  if (!Array.isArray(raw))
    throw new Error("Stored persistent errors are not an array")
  return PersistentErrorsSchema.parse(
    raw.flatMap((value) => migratePersistentError(value, now))
  )
}

type TaskChapter = DownloadTaskState["chapters"][number]

function retainedOutputCounts(chapter: TaskChapter) {
  const previous = chapter.outputs ?? { requested: 0, committed: 0, failed: 0 }
  const requested = Math.max(0, previous.requested)
  const committed = Math.max(0, previous.committed)
  return {
    requested,
    committed,
    failed: Math.max(0, previous.failed, requested - committed),
  }
}

function interruptedChapterResult(
  chapter: TaskChapter,
  outputs: ReturnType<typeof retainedOutputCounts>
) {
  const complete =
    chapter.status === "downloading" &&
    outputs.requested > 0 &&
    outputs.committed === outputs.requested &&
    outputs.failed === 0
  if (complete)
    return {
      status: "completed" as const,
      errorMessage: undefined,
      errorCategory: undefined,
    }
  return {
    status:
      chapter.status === "downloading" && outputs.committed > 0
        ? ("partial_success" as const)
        : ("failed" as const),
    errorMessage: UPDATE_INTERRUPTION_MESSAGE,
    errorCategory: "unknown" as const,
  }
}

function normalizeRetainedInterruptedChapter(
  chapter: TaskChapter,
  now: number
): TaskChapter {
  if (chapter.status !== "downloading" && chapter.status !== "queued")
    return chapter
  const outputs = retainedOutputCounts(chapter)
  return {
    ...chapter,
    ...interruptedChapterResult(chapter, outputs),
    ...(chapter.status === "downloading" && outputs.committed > 0
      ? { outputs }
      : {}),
    lastUpdated: now,
  }
}

function interruptedTaskStatus(
  chapters: TaskChapter[]
): DownloadTaskState["status"] {
  if (
    chapters.length > 0 &&
    chapters.every((chapter) => chapter.status === "completed")
  )
    return "completed"
  return chapters.some(
    (chapter) =>
      chapter.status === "completed" || chapter.status === "partial_success"
  )
    ? "partial_success"
    : "failed"
}

function interruptedTaskFailure(
  chapters: TaskChapter[],
  status: DownloadTaskState["status"]
) {
  if (status === "completed")
    return { errorMessage: undefined, errorCategory: undefined }
  const firstFailure = chapters.find(
    (chapter) =>
      chapter.status === "failed" || chapter.status === "partial_success"
  )
  return {
    errorMessage: firstFailure?.errorMessage ?? UPDATE_INTERRUPTION_MESSAGE,
    errorCategory: firstFailure?.errorCategory ?? ("unknown" as const),
  }
}

function normalizeRetainedInterruptedTask(
  task: DownloadTaskState,
  now: number
): DownloadTaskState {
  const chapters = task.chapters.map((chapter) =>
    normalizeRetainedInterruptedChapter(chapter, now)
  )
  const status = interruptedTaskStatus(chapters)
  return {
    ...task,
    chapters,
    status,
    activeBlock: undefined,
    destinationIssue: undefined,
    ...interruptedTaskFailure(chapters, status),
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

const JOURNAL_QUEUE_CODECS: Record<
  number,
  { task: z.ZodType; undo: z.ZodType }
> = {
  3: { task: DownloadTaskStateSchema, undo: PendingUndoActionSchema },
  4: { task: DownloadTaskStateSchema, undo: PendingUndoActionSchema },
  5: {
    task: Epoch5DownloadTaskStateSchema,
    undo: Epoch5PendingUndoActionSchema,
  },
  6: { task: CurrentTaskSchema, undo: CurrentUndoSchema },
  7: {
    task: CurrentDownloadTaskStateSchema,
    undo: CurrentPendingUndoActionSchema,
  },
  8: { task: TerminalTaskSchema, undo: TerminalUndoSchema },
  9: { task: FallbackTaskSchema, undo: FallbackUndoSchema },
  10: { task: FallbackTaskSchema, undo: FallbackUndoSchema },
}

function isNativeJournalWriteKey(key: string, targetEpoch: number): boolean {
  if (targetEpoch !== 4 && targetEpoch !== 7) return false
  return (
    key === nativeStorageKeys.index ||
    key.startsWith(nativeStorageKeys.manifestPrefix) ||
    key.startsWith(nativeStorageKeys.outputPrefix)
  )
}

function validateJournalWriteKeys(journal: MigrationJournal): void {
  for (const key of [
    LOCAL_STORAGE_KEYS.downloadQueue,
    LOCAL_STORAGE_KEYS.pendingUndoActions,
  ]) {
    if (!Object.hasOwn(journal.writes, key))
      throw new Error(
        `State migration journal is missing canonical write key: ${key}`
      )
  }
  for (const key of Object.keys(journal.writes)) {
    const timing =
      journal.targetEpoch === 10 &&
      key === LOCAL_STORAGE_KEYS.progressTimingEstimates
    if (
      !MIGRATION_WRITE_KEYS.has(key) &&
      !timing &&
      !isNativeJournalWriteKey(key, journal.targetEpoch)
    )
      throw new Error(
        `State migration journal contains an invalid write key: ${key}`
      )
  }
}

function validateJournalObsoleteKeys(journal: MigrationJournal): void {
  const seen = new Set<string>()
  for (const key of journal.obsoleteKeys) {
    if (!MIGRATION_OBSOLETE_KEYS.has(key))
      throw new Error(
        `State migration journal contains an invalid obsolete key: ${key}`
      )
    if (seen.has(key))
      throw new Error(
        `State migration journal contains a duplicate obsolete key: ${key}`
      )
    seen.add(key)
  }
}

function validateJournalQueue(journal: MigrationJournal): void {
  const codecs = JOURNAL_QUEUE_CODECS[journal.targetEpoch]
  const queue = journal.writes[LOCAL_STORAGE_KEYS.downloadQueue]
  const undo = journal.writes[LOCAL_STORAGE_KEYS.pendingUndoActions]
  z.array(codecs.task).parse(
    journal.targetEpoch === 3
      ? (queue as unknown[]).map(convertStoredTask)
      : queue
  )
  z.array(codecs.undo).parse(
    journal.targetEpoch === 3
      ? (undo as unknown[]).map(convertStoredUndo)
      : undo
  )
}

function validateJournalSettings(journal: MigrationJournal): void {
  if (Object.hasOwn(journal.writes, LOCAL_STORAGE_KEYS.settings)) {
    const parse =
      journal.targetEpoch >= 9
        ? parseCurrentSettingsDocument
        : parseSettingsDocument
    parse(journal.writes[LOCAL_STORAGE_KEYS.settings])
  }
  const providerParsers = [
    [
      SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY,
      parseSiteIntegrationEnablementDocument,
    ],
    [
      SITE_INTEGRATION_SETTINGS_STORAGE_KEY,
      parseSiteIntegrationSettingsDocument,
    ],
    [SITE_OVERRIDES_STORAGE_KEY, parseSiteOverridesDocument],
  ] as const
  for (const [key, parse] of providerParsers) {
    if (!Object.hasOwn(journal.writes, key)) continue
    const raw = journal.writes[key]
    parse(
      journal.targetEpoch <= 9 ? currentIntegrationMapForValidation(raw) : raw
    )
  }
}

function validateJournalAuxiliaryDocuments(journal: MigrationJournal): void {
  if (
    Object.hasOwn(journal.writes, LOCAL_STORAGE_KEYS.progressTimingEstimates)
  ) {
    z.record(z.string(), z.unknown()).parse(
      journal.writes[LOCAL_STORAGE_KEYS.progressTimingEstimates]
    )
  }
  if (Object.hasOwn(journal.writes, LOCAL_STORAGE_KEYS.persistentErrors)) {
    PersistentErrorsSchema.parse(
      journal.writes[LOCAL_STORAGE_KEYS.persistentErrors]
    )
  }
}

function validateJournalNativeOutput(journal: MigrationJournal): void {
  if (
    !Object.keys(journal.writes).some((key) =>
      key.startsWith("pendingOutputs:")
    )
  )
    return
  if (!Object.hasOwn(journal.writes, nativeStorageKeys.index))
    throw new Error(
      "State migration journal is missing the native output index"
    )
  validateNativeOutputMigrationWrites(
    journal.writes,
    journal.targetEpoch === 7 ? parseCurrentNativeOutputState : undefined
  )
}

function validateJournalHistory(journal: MigrationJournal): void {
  const keys = [
    LOCAL_STORAGE_KEYS.downloadedChapters,
    LOCAL_STORAGE_KEYS.seriesDownloadHistory,
    LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs,
  ]
  const present = keys.filter((key) => Object.hasOwn(journal.writes, key))
  if (present.length === 0) return
  if (present.length !== keys.length)
    throw new Error(
      "State migration journal contains a partial history aggregate"
    )
  const validate =
    journal.targetEpoch >= 5
      ? validateSaveEvidenceHistory
      : parseHistoryAggregate
  validate({
    downloadedChapters: journal.writes[LOCAL_STORAGE_KEYS.downloadedChapters],
    seriesDownloadHistory:
      journal.writes[LOCAL_STORAGE_KEYS.seriesDownloadHistory],
    clearCutoffs:
      journal.writes[LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs],
  })
}

function validateMigrationJournal(journal: MigrationJournal): void {
  if (!MIGRATION_STEPS.some((step) => step.targetEpoch === journal.targetEpoch))
    throw new Error("State migration journal has an unsupported target epoch")
  validateJournalWriteKeys(journal)
  validateJournalObsoleteKeys(journal)
  validateJournalQueue(journal)
  validateJournalSettings(journal)
  validateJournalAuxiliaryDocuments(journal)
  validateJournalNativeOutput(journal)
  validateJournalHistory(journal)
}

function obsoleteDestinationKeys(stored: Record<string, unknown>): string[] {
  const keys = [
    OBSOLETE_COMMAND_RESULTS_KEY,
    LOCAL_STORAGE_KEYS.pendingOutputs,
    LOCAL_STORAGE_KEYS.activeDispatchLease,
    LEGACY_DESTINATION_ISSUES_STORAGE_KEY,
  ]
  return keys.filter((key) => {
    if (key === LOCAL_STORAGE_KEYS.activeDispatchLease)
      return (
        stored[key] !== undefined &&
        !ActiveDispatchLeaseSchema.safeParse(stored[key]).success
      )
    return key in stored
  })
}

function interruptLegacyQueue(
  queue: DownloadTaskState[],
  stored: Record<string, unknown>,
  now: number
) {
  const obsolete = obsoleteDestinationKeys(stored)
  if (
    !obsolete.includes(LOCAL_STORAGE_KEYS.activeDispatchLease) &&
    !obsolete.includes(LOCAL_STORAGE_KEYS.pendingOutputs)
  )
    return queue
  const inFlight = legacyInFlightTaskIds(stored)
  return queue.map((task) =>
    inFlight.has(task.id) &&
    (task.status === "queued" || task.status === "downloading")
      ? normalizeRetainedInterruptedTask(task, now)
      : task
  )
}

function legacyDocumentWrites(
  stored: Record<string, unknown>,
  now: number
): Record<string, unknown> {
  const writes: Record<string, unknown> = {}
  const settings = canonicalizeSettings(stored[LOCAL_STORAGE_KEYS.settings])
  if (settings) writes[LOCAL_STORAGE_KEYS.settings] = settings
  const history = migrateHistory(stored)
  if (history) Object.assign(writes, history)
  const documents = [
    [SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY, migrateEnablement],
    [SITE_INTEGRATION_SETTINGS_STORAGE_KEY, migrateSiteSettings],
    [SITE_OVERRIDES_STORAGE_KEY, migrateSiteOverrides],
    [
      LOCAL_STORAGE_KEYS.persistentErrors,
      (raw: unknown) => migratePersistentErrors(raw, now),
    ],
  ] as const
  for (const [key, migrate] of documents) {
    const value = migrate(stored[key])
    if (value) writes[key] = value
  }
  return writes
}

function buildDestinationPairingJournal(
  stored: Record<string, unknown>,
  sourceEpoch: number | null
): MigrationJournal {
  const now = Date.now()
  const isReleasedEpoch2 = sourceEpoch === 2
  const queue = isReleasedEpoch2
    ? migrateQueue(
        stored[LOCAL_STORAGE_KEYS.downloadQueue],
        migrateEpoch2DownloadTask
      )
    : migrateQueue(stored[LOCAL_STORAGE_KEYS.downloadQueue])
  const undo = isReleasedEpoch2
    ? migrateEpoch2PendingUndoActions(
        stored[LOCAL_STORAGE_KEYS.pendingUndoActions]
      )
    : migratePendingUndoActions(stored[LOCAL_STORAGE_KEYS.pendingUndoActions])
  const paired = attachDestinationIssues(
    queue,
    undo,
    stored[LEGACY_DESTINATION_ISSUES_STORAGE_KEY]
  )
  const writes: Record<string, unknown> = {
    [LOCAL_STORAGE_KEYS.downloadQueue]: interruptLegacyQueue(
      paired.queue,
      stored,
      now
    ),
    [LOCAL_STORAGE_KEYS.pendingUndoActions]: paired.pendingUndoActions,
    ...legacyDocumentWrites(stored, now),
  }
  const journal = MigrationJournalSchema.parse({
    sourceEpoch,
    targetEpoch: DESTINATION_PAIRING_EPOCH,
    phase: "prepared",
    writes,
    obsoleteKeys: obsoleteDestinationKeys(stored),
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
  {
    targetEpoch: 9,
    prepare: (
      stored: Record<string, unknown>,
      sourceEpoch: number | null
    ): MigrationJournal => {
      const source = stored[LOCAL_STORAGE_KEYS.settings]
      const settings =
        source === undefined ? undefined : parseSettingsDocument(source)
      const journal = MigrationJournalSchema.parse({
        sourceEpoch,
        targetEpoch: 9,
        phase: "prepared",
        writes: {
          [LOCAL_STORAGE_KEYS.downloadQueue]: z
            .array(TerminalTaskSchema)
            .parse(
              stored[LOCAL_STORAGE_KEYS.downloadQueue] === undefined
                ? []
                : stored[LOCAL_STORAGE_KEYS.downloadQueue]
            ),
          [LOCAL_STORAGE_KEYS.pendingUndoActions]: z
            .array(TerminalUndoSchema)
            .parse(
              stored[LOCAL_STORAGE_KEYS.pendingUndoActions] === undefined
                ? []
                : stored[LOCAL_STORAGE_KEYS.pendingUndoActions]
            ),
          ...(settings
            ? {
                [LOCAL_STORAGE_KEYS.settings]: parseCurrentSettingsDocument({
                  ...settings,
                  downloads: {
                    ...settings.downloads,
                    allowChromeFallback: false,
                  },
                }),
              }
            : {}),
        },
        obsoleteKeys: [],
      })
      validateMigrationJournal(journal)
      return journal
    },
  },
  {
    targetEpoch: 10,
    prepare: (
      stored: Record<string, unknown>,
      sourceEpoch: number | null
    ): MigrationJournal => {
      const journal = MigrationJournalSchema.parse({
        sourceEpoch,
        targetEpoch: 10,
        phase: "prepared",
        writes: buildIntegrationIdWrites(stored),
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

async function readNativeMigrationRecords(
  stored: Record<string, unknown>
): Promise<void> {
  const epochs = new Set<unknown>([3, 4, 5, 6])
  if (
    !epochs.has(stored[SCHEMA_EPOCH_STORAGE_KEY]) ||
    stored[MIGRATION_JOURNAL_STORAGE_KEY] !== undefined
  )
    return
  let index
  try {
    index = parseNativeStorageIndex(stored[nativeStorageKeys.index])
  } catch (cause) {
    throw new InvalidDurableStateError("Invalid durable native output index", {
      cause,
    })
  }
  const keys = [
    ...index.jobIds.map((id) => nativeStorageKeys.manifestPrefix + id),
    ...index.outputIds.map((id) => nativeStorageKeys.outputPrefix + id),
  ]
  if (keys.length > 0)
    Object.assign(stored, await chrome.storage.local.get(keys))
}

function readExistingMigrationJournal(
  stored: Record<string, unknown>,
  epoch: number | null
) {
  const journal = parseMigrationJournal(stored[MIGRATION_JOURNAL_STORAGE_KEY])
  if (journal === null) return null
  validateMigrationJournalAgainstStoredState(journal, stored, epoch)
  if (epoch === journal.targetEpoch && journal.phase !== "obsolete-removed")
    throw new Error(
      "State migration journal phase is inconsistent with the current epoch"
    )
  return journal
}

function prepareNextMigrationJournal(
  stored: Record<string, unknown>,
  epoch: number | null
) {
  const step = MIGRATION_STEPS.find(
    (candidate) => candidate.targetEpoch > (epoch ?? -1)
  )
  if (!step) throw new Error("No supported state migration step")
  return step.prepare(stored, epoch)
}

function readMigrationPlan(stored: Record<string, unknown>) {
  try {
    const epoch = readSupportedEpoch(stored[SCHEMA_EPOCH_STORAGE_KEY])
    const existing = readExistingMigrationJournal(stored, epoch)
    if (existing) return { journal: existing, prepared: true }
    if (epoch === CURRENT_STATE_SCHEMA_EPOCH) return null
    return {
      journal: prepareNextMigrationJournal(stored, epoch),
      prepared: false,
    }
  } catch (cause) {
    throw new InvalidDurableStateError(
      cause instanceof Error ? cause.message : "Invalid retained state",
      { cause }
    )
  }
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
      await readNativeMigrationRecords(stored)
      const plan = readMigrationPlan(stored)
      if (plan === null) return
      if (!plan.prepared) await persistMigrationJournal(plan.journal)
      logger.info(
        `[Init] Migrating durable state schema from ${String(plan.journal.sourceEpoch)} to ${plan.journal.targetEpoch}`
      )
      await replayMigrationJournal(plan.journal)
      stored = await chrome.storage.local.get([...MIGRATION_STORAGE_KEYS])
    }
  } catch (error) {
    logger.error("Durable state schema migration failed", error)
    throw error
  }
}
