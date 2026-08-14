import type { QueueApplicationCommands } from "@/entrypoints/background/queue-application-commands"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import type { DownloadStateQueryService } from "@/entrypoints/background/download-state-query-service"
import type { OptionsConfigurationService } from "@/entrypoints/background/options-configuration-service"
import type { SettingsRepository } from "@/src/storage/settings-repository"
import type { HistoryRepository } from "@/src/storage/history-repository"
import type { SiteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"

export interface BackgroundRuntimeHandlerDependencies {
  settingsRepository: SettingsRepository
  historyRepository: HistoryRepository
  siteIntegrationEnablementService: SiteIntegrationEnablementService
  queueRepository: QueueRepository
  queueApplicationCommands: QueueApplicationCommands
  nativeOutputCoordinator: NativeOutputCoordinator
  terminalCoordinator: OffscreenJobTerminalCoordinator
  downloadStateQueryService: DownloadStateQueryService
  optionsConfigurationService: OptionsConfigurationService
  ensureOffscreenDocumentReady: () => Promise<void>
  tabContextResolver: {
    resolveTabContext: (
      tabId: number,
      options?: { windowId?: number; allowCached?: boolean }
    ) => Promise<void>
  }
}
