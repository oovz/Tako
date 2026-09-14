import type { SettingsRepository } from "@/src/storage/settings-repository"
import { type HistoryRepository } from "@/src/storage/history-repository"
import { applySettingsSideEffects } from "@/src/storage/settings-subscriber"
import { StorageMutationQueue } from "@/src/storage/storage-mutation-queue"
import type {
  OptionsConfigurationRepository,
  OptionsConfigurationSnapshot,
} from "@/src/storage/options-configuration-repository"

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

export interface OptionsConfigurationServiceDependencies {
  configurationRepository: OptionsConfigurationRepository
  settingsRepository: Pick<SettingsRepository, "acceptExternalDocument">
  historyRepository: Pick<
    HistoryRepository,
    "getStorageStats" | "getAllSeriesHistory"
  >
  applySettingsSideEffects: typeof applySettingsSideEffects
  cleanupRateLimiters: () => void
}

export class OptionsConfigurationService {
  private readonly mutations = new StorageMutationQueue()

  constructor(private readonly deps: OptionsConfigurationServiceDependencies) {}

  async getConfiguration(): Promise<OptionsConfigurationSnapshot> {
    return await this.mutations.run(() =>
      this.deps.configurationRepository.get()
    )
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
    // Detach the caller's document before entering the queue. A caller cannot
    // mutate the submitted document while an earlier read or save is draining.
    const submitted = structuredClone(next)
    return this.mutations.run(async () => {
      const saved = await this.deps.configurationRepository.save(submitted)

      // Durable storage is authoritative. Publish caches and dependent
      // projections only after the single multi-key write has completed.
      this.deps.settingsRepository.acceptExternalDocument(saved.settings)
      await this.deps.applySettingsSideEffects(saved.settings)
      this.deps.cleanupRateLimiters()

      return saved
    })
  }
}
