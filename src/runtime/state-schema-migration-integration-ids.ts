import { z } from "zod"

import { rebuildSeriesHistory } from "@/src/domain/history/cleanup-policy"
import { parseHistoryAggregate } from "@/src/domain/history/schema"
import { getDefinition } from "@/src/site-integrations/catalog"
import { isRecord } from "@/src/shared/type-guards"
import {
  SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY,
  parseSiteIntegrationEnablementDocument,
} from "@/src/storage/site-integration-enablement-service"
import {
  SITE_INTEGRATION_SETTINGS_STORAGE_KEY,
  parseSiteIntegrationSettingsDocument,
} from "@/src/storage/site-integration-settings-service"
import {
  SITE_OVERRIDES_STORAGE_KEY,
  parseSiteOverridesDocument,
} from "@/src/storage/site-overrides-service"
import {
  DownloadTaskStateSchema,
  PendingUndoActionSchema,
} from "./queue-state-schemas"
import { LOCAL_STORAGE_KEYS } from "./storage-keys"

/** Released identifiers remain confined to the one-way upgrade boundary. */
const renamedIntegrationIds = new Map([
  ["aimanhua", "lovemanga"],
  ["comicnettai", "comictropics"],
  ["dm5", "animemangahouse"],
  ["manhuagui", "readmanga"],
  ["zaimanhua", "mangaagain"],
  ["mangakakalove", "mangakakalot"],
])

function currentIntegrationId(id: string): string {
  return renamedIntegrationIds.get(id) ?? id
}

export function getHistoricalIntegrationDefinition(id: string) {
  return getDefinition(currentIntegrationId(id))
}

function rekey<T>(
  source: Record<string, T>,
  convertKey: (key: string) => string
): Record<string, T> {
  const entries = Object.entries(source).map(
    ([key, value]) => [convertKey(key), value] as const
  )
  const keys = new Set(entries.map(([key]) => key))
  if (keys.size !== entries.length) {
    throw new Error("Stored integration identifiers have conflicting keys")
  }
  return Object.fromEntries(entries)
}

/** Validate old journals through a transient copy; replay retains their writes. */
export function currentIntegrationMapForValidation(raw: unknown): unknown {
  return isRecord(raw) ? rekey(raw, currentIntegrationId) : raw
}

function currentCompositeKey(key: string, separator: string): string {
  const index = key.indexOf(separator)
  return index < 0
    ? key
    : currentIntegrationId(key.slice(0, index)) + key.slice(index)
}

function convertTask(task: z.infer<typeof DownloadTaskStateSchema>) {
  return {
    ...task,
    siteIntegrationId: currentIntegrationId(task.siteIntegrationId),
    settingsSnapshot: {
      ...task.settingsSnapshot,
      siteIntegrationId: currentIntegrationId(
        task.settingsSnapshot.siteIntegrationId
      ),
    },
  }
}

export function buildIntegrationIdWrites(
  stored: Record<string, unknown>
): Record<string, unknown> {
  const writes: Record<string, unknown> = {
    [LOCAL_STORAGE_KEYS.downloadQueue]: z
      .array(DownloadTaskStateSchema)
      .parse(
        stored[LOCAL_STORAGE_KEYS.downloadQueue] === undefined
          ? []
          : stored[LOCAL_STORAGE_KEYS.downloadQueue]
      )
      .map(convertTask),
    [LOCAL_STORAGE_KEYS.pendingUndoActions]: z
      .array(PendingUndoActionSchema)
      .parse(
        stored[LOCAL_STORAGE_KEYS.pendingUndoActions] === undefined
          ? []
          : stored[LOCAL_STORAGE_KEYS.pendingUndoActions]
      )
      .map((action) => ({
        ...action,
        taskSnapshot: convertTask(action.taskSnapshot),
      })),
  }

  for (const [key, parse] of [
    [
      SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY,
      parseSiteIntegrationEnablementDocument,
    ],
    [
      SITE_INTEGRATION_SETTINGS_STORAGE_KEY,
      parseSiteIntegrationSettingsDocument,
    ],
    [SITE_OVERRIDES_STORAGE_KEY, parseSiteOverridesDocument],
  ] as const) {
    if (Object.hasOwn(stored, key)) {
      writes[key] = parse(currentIntegrationMapForValidation(stored[key]))
    }
  }

  const historyKeys = [
    LOCAL_STORAGE_KEYS.downloadedChapters,
    LOCAL_STORAGE_KEYS.seriesDownloadHistory,
    LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs,
  ]
  if (historyKeys.some((key) => Object.hasOwn(stored, key))) {
    const aggregate = parseHistoryAggregate({
      downloadedChapters: stored[LOCAL_STORAGE_KEYS.downloadedChapters],
      seriesDownloadHistory: stored[LOCAL_STORAGE_KEYS.seriesDownloadHistory],
      clearCutoffs: stored[LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs],
    })
    const records = aggregate.downloadedChapters.map((record) => ({
      ...record,
      siteIntegrationId: currentIntegrationId(record.siteIntegrationId),
    }))
    writes[LOCAL_STORAGE_KEYS.downloadedChapters] = records
    writes[LOCAL_STORAGE_KEYS.seriesDownloadHistory] =
      rebuildSeriesHistory(records)
    writes[LOCAL_STORAGE_KEYS.downloadHistoryClearCutoffs] = {
      ...aggregate.clearCutoffs,
      bySeries: rekey(aggregate.clearCutoffs.bySeries, (key) =>
        currentCompositeKey(key, "#")
      ),
      byChapter: rekey(aggregate.clearCutoffs.byChapter, (key) =>
        currentCompositeKey(key, "\0")
      ),
    }
  }

  const timing = stored[LOCAL_STORAGE_KEYS.progressTimingEstimates]
  if (isRecord(timing)) {
    writes[LOCAL_STORAGE_KEYS.progressTimingEstimates] = rekey(timing, (key) =>
      currentCompositeKey(key, "|")
    )
  }
  return writes
}
