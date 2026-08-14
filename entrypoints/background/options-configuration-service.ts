import type { ExtensionSettings } from "@/src/domain/settings/types"
import {
  parseSettingsDocument,
  cloneSettings,
} from "@/src/domain/settings/schema"
import {
  SETTINGS_STORAGE_KEY,
  type SettingsRepository,
} from "@/src/storage/settings-repository"
import {
  type SiteOverridesMap,
  type SiteIntegrationEnablementMap,
  type SiteIntegrationSettingsMap,
} from "@/src/domain/site-integrations/storage-schemas"
import {
  parseSiteOverridesDocument,
  SITE_OVERRIDES_STORAGE_KEY,
} from "@/src/storage/site-overrides-service"
import {
  parseSiteIntegrationEnablementDocument,
  SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY,
} from "@/src/storage/site-integration-enablement-service"
import {
  SITE_INTEGRATION_SETTINGS_STORAGE_KEY,
  parseSiteIntegrationSettingsDocument,
} from "@/src/storage/site-integration-settings-service"
import { type HistoryRepository } from "@/src/storage/history-repository"
import { applySettingsSideEffects } from "@/src/storage/settings-subscriber"
import { StorageMutationQueue } from "@/src/storage/storage-mutation-queue"

export interface OptionsConfigurationSnapshot {
  settings: ExtensionSettings
  overrides: SiteOverridesMap
  enablement: SiteIntegrationEnablementMap
  integrationSettings: SiteIntegrationSettingsMap
}

export interface OptionsHistorySeries {
  siteIntegrationId: string
  seriesId: string
  seriesTitle: string
  chapterCount: number
}

export interface OptionsHistoryStats {
  totalChapters: number
  totalSeries: number
}

export interface OptionsConfigurationData {
  configuration: OptionsConfigurationSnapshot
  historyStats: OptionsHistoryStats
  historySeries: OptionsHistorySeries[]
}

export interface OptionsConfigurationStorage {
  get(keys: string[]): Promise<Record<string, unknown>>
  set(values: Record<string, unknown>): Promise<void>
}

export interface OptionsConfigurationServiceDependencies {
  storage: OptionsConfigurationStorage
  settingsRepository: Pick<
    SettingsRepository,
    "getSettings" | "acceptExternalDocument"
  >
  historyRepository: Pick<
    HistoryRepository,
    "getStorageStats" | "getAllSeriesHistory"
  >
  applySettingsSideEffects: typeof applySettingsSideEffects
  cleanupRateLimiters: () => void
}

const CONFIGURATION_STORAGE_KEYS = [
  SETTINGS_STORAGE_KEY,
  SITE_OVERRIDES_STORAGE_KEY,
  SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY,
  SITE_INTEGRATION_SETTINGS_STORAGE_KEY,
] as const

function cloneConfiguration(
  configuration: OptionsConfigurationSnapshot
): OptionsConfigurationSnapshot {
  return {
    settings: cloneSettings(configuration.settings),
    overrides: structuredClone(configuration.overrides),
    enablement: structuredClone(configuration.enablement),
    integrationSettings: structuredClone(configuration.integrationSettings),
  }
}

function parseConfigurationDocument(
  value: Record<string, unknown>
): OptionsConfigurationSnapshot {
  if (!Object.hasOwn(value, SETTINGS_STORAGE_KEY)) {
    throw new Error(`Missing required storage key: ${SETTINGS_STORAGE_KEY}`)
  }
  const settings = parseSettingsDocument(value[SETTINGS_STORAGE_KEY])
  const overrides = Object.hasOwn(value, SITE_OVERRIDES_STORAGE_KEY)
    ? parseSiteOverridesDocument(value[SITE_OVERRIDES_STORAGE_KEY])
    : {}
  const enablement = Object.hasOwn(
    value,
    SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY
  )
    ? parseSiteIntegrationEnablementDocument(
        value[SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY]
      )
    : {}
  const integrationSettings = Object.hasOwn(
    value,
    SITE_INTEGRATION_SETTINGS_STORAGE_KEY
  )
    ? parseSiteIntegrationSettingsDocument(
        value[SITE_INTEGRATION_SETTINGS_STORAGE_KEY]
      )
    : {}

  return { settings, overrides, enablement, integrationSettings }
}

function validateConfiguration(
  configuration: OptionsConfigurationSnapshot
): OptionsConfigurationSnapshot {
  return parseConfigurationDocument({
    [SETTINGS_STORAGE_KEY]: configuration.settings,
    [SITE_OVERRIDES_STORAGE_KEY]: configuration.overrides,
    [SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY]: configuration.enablement,
    [SITE_INTEGRATION_SETTINGS_STORAGE_KEY]: configuration.integrationSettings,
  })
}

export class OptionsConfigurationService {
  private readonly mutations = new StorageMutationQueue()

  constructor(private readonly deps: OptionsConfigurationServiceDependencies) {}

  async getConfiguration(): Promise<OptionsConfigurationSnapshot> {
    return this.mutations.run(async () => {
      const stored = await this.deps.storage.get([
        ...CONFIGURATION_STORAGE_KEYS,
      ])
      const initialized = Object.hasOwn(stored, SETTINGS_STORAGE_KEY)
        ? stored
        : {
            ...stored,
            [SETTINGS_STORAGE_KEY]:
              await this.deps.settingsRepository.getSettings(),
          }
      return parseConfigurationDocument(initialized)
    })
  }

  async getOptionsConfiguration(): Promise<OptionsConfigurationData> {
    const [configuration, historyStats, seriesHistory] = await Promise.all([
      this.getConfiguration(),
      this.deps.historyRepository.getStorageStats(),
      this.deps.historyRepository.getAllSeriesHistory(),
    ])

    return {
      configuration,
      historyStats: {
        totalChapters: historyStats.totalChapters,
        totalSeries: historyStats.totalSeries,
      },
      historySeries: seriesHistory
        .map((entry) => ({
          siteIntegrationId: entry.siteIntegrationId,
          seriesId: entry.seriesId,
          seriesTitle: entry.seriesTitle,
          chapterCount: entry.downloadedChapters.length,
        }))
        .sort((left, right) =>
          left.seriesTitle.localeCompare(right.seriesTitle)
        ),
    }
  }

  async saveConfiguration(
    next: OptionsConfigurationSnapshot
  ): Promise<OptionsConfigurationSnapshot> {
    // Validate and clone before entering the queue. A caller cannot mutate the
    // submitted document while an earlier read or save is draining.
    const validated = validateConfiguration(next)

    return this.mutations.run(async () => {
      await this.deps.storage.set({
        [SETTINGS_STORAGE_KEY]: validated.settings,
        [SITE_OVERRIDES_STORAGE_KEY]: validated.overrides,
        [SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY]: validated.enablement,
        [SITE_INTEGRATION_SETTINGS_STORAGE_KEY]: validated.integrationSettings,
      })

      // Durable storage is authoritative. Publish caches and dependent
      // projections only after the single multi-key write has completed.
      this.deps.settingsRepository.acceptExternalDocument(validated.settings)
      await this.deps.applySettingsSideEffects(validated.settings)
      this.deps.cleanupRateLimiters()

      return cloneConfiguration(validated)
    })
  }
}
