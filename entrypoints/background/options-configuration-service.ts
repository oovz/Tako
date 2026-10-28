import logger from "@/src/runtime/logger"
import { runDestinationAccessExclusive } from "./destination-access"
import {
  DirectoryNotFoundError,
  PermissionExpiredError,
} from "@/src/types/errors"
import {
  checkPermissionBeforeWrite,
  loadDownloadRootHandle,
  removeUnusedDownloadRootHandles,
} from "@/src/storage/fs-access"
import { t } from "@/src/runtime/i18n"
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
  private readonly unsettledHandleCleanup = new Set<string>()
  private readonly pendingSaves = new Set<OptionsConfigurationSnapshot>()

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
    this.pendingSaves.add(submitted)
    const submittedHandleId =
      submitted.settings.downloads.customDirectoryHandleId
    if (submittedHandleId) this.unsettledHandleCleanup.add(submittedHandleId)
    return this.mutations.run(() =>
      runDestinationAccessExclusive(async () => {
        try {
          if (
            submitted.settings.downloads.destination === "file-system-access"
          ) {
            let handle: FileSystemDirectoryHandle | undefined
            try {
              handle = await loadDownloadRootHandle(
                submitted.settings.downloads.customDirectoryHandleId
              )
              if (handle && handle.kind === "directory")
                await checkPermissionBeforeWrite(handle)
            } catch (error) {
              logger.warn(
                "[OPTIONS] Saved folder capability validation failed",
                error
              )
              const message =
                error instanceof PermissionExpiredError
                  ? "settings_customFolderPermissionDenied"
                  : error instanceof DirectoryNotFoundError
                    ? "settings_customFolderNotFound"
                    : "options_savedFolderRepairRequired"
              throw new Error(t(message), { cause: error })
            }
            if (!handle || handle.kind !== "directory")
              throw new Error(t("settings_customFolderRequired"))
          }
          const previous = await this.deps.configurationRepository.get()
          for (const configuration of [previous, submitted]) {
            const id = configuration.settings.downloads.customDirectoryHandleId
            if (id) this.unsettledHandleCleanup.add(id)
          }
          const saved = await this.deps.configurationRepository.save(submitted)

          // Publish the committed configuration after its capability is durable.
          this.deps.settingsRepository.acceptExternalDocument(saved.settings)
          await this.deps.applySettingsSideEffects(saved.settings)
          this.deps.cleanupRateLimiters()
          return saved
        } finally {
          this.pendingSaves.delete(submitted)
          // A failed acknowledgement can follow a committed write. Read durable
          // authority before reclaiming either the previous or staged capability.
          try {
            const current = await this.deps.configurationRepository.get()
            const retainedIds = new Set<string>()
            for (const configuration of [current, ...this.pendingSaves]) {
              const id =
                configuration.settings.downloads.customDirectoryHandleId
              if (id) retainedIds.add(id)
            }
            await removeUnusedDownloadRootHandles(
              this.unsettledHandleCleanup,
              retainedIds
            )
            for (const id of this.unsettledHandleCleanup) {
              if (!retainedIds.has(id)) this.unsettledHandleCleanup.delete(id)
            }
          } catch (error) {
            logger.warn(
              "[OPTIONS] Could not reclaim unused folder capabilities",
              error
            )
          }
        }
      })
    )
  }
}
