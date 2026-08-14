import logger from "@/src/runtime/logger"
import { applyUiLanguagePreference } from "@/src/runtime/i18n"
import type { TabContextStateService } from "@/entrypoints/background/tab-context-state-service"
import type { RuntimeMessageReadiness } from "@/src/runtime/runtime-message-contracts"
import {
  RuntimePhaseError,
  isFatalRuntimeInitializationError,
  type BackgroundRuntimePhase,
} from "@/src/runtime/runtime-phase-errors"
import { validateBackgroundSiteIntegrations } from "@/src/runtime/background-site-integration-initialization"
import { setEnablementMap } from "@/src/site-integrations/catalog"
import { reconcileBroadHttpsPermissionEnablement } from "@/src/site-integrations/host-permission-service"
import type { SettingsRepository } from "@/src/storage/settings-repository"
import type { SiteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { HistoryRepository } from "@/src/storage/history-repository"
import type { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import type { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import type { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import type { DestinationService } from "@/entrypoints/background/destination"
import {
  getOffscreenContexts,
  hasOffscreenDocument,
  queryOffscreenJob,
  queryOffscreenStatus,
  terminateOffscreenDocumentForUnboundLease,
} from "@/entrypoints/background/offscreen-lifecycle"
import { initializeFromStorage } from "@/entrypoints/background/initialize-from-storage"
import type { StartupQueueActivation } from "@/src/domain/queue/scheduler-policy"
import { recoverPendingUndoActions } from "@/entrypoints/background/pending-undo-coordinator"
import { reconcileCompletedChapterHistory } from "@/entrypoints/background/download-queue-finalization"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"

interface PhaseState {
  completed: boolean
  inFlight: Promise<void> | null
  fatalError: RuntimePhaseError | null
}

interface IntegrationGenerationState extends PhaseState {
  generation: number
}

export interface BackgroundRuntimeKernelInput {
  settingsRepository: SettingsRepository
  siteIntegrationEnablementService: SiteIntegrationEnablementService
  tabContextStateService: TabContextStateService
  queueRepository: QueueRepository
  historyRepository: HistoryRepository
  nativeOutputCoordinator: NativeOutputCoordinator
  terminalCoordinator: OffscreenJobTerminalCoordinator
  ensureLivenessAlarm: () => Promise<void>
  setLivenessAlarmArmed: (shouldArm: boolean) => Promise<void>
  queueScheduler: QueueScheduler
  destinationService: DestinationService
}

function createPhaseState(): PhaseState {
  return { completed: false, inFlight: null, fatalError: null }
}

export class BackgroundRuntimeKernel {
  private readonly statePhase = createPhaseState()
  private readonly queuePhase = createPhaseState()
  private readonly runtimePhase = createPhaseState()
  private integrationPhase: IntegrationGenerationState = {
    ...createPhaseState(),
    generation: 0,
  }
  private tabContextStateService: TabContextStateService | null = null
  private controlReady = false
  private readonly controlReadyPromise: Promise<void>
  private resolveControlReady!: () => void
  private activation: StartupQueueActivation | undefined
  private activationCompleted = false
  private activationInFlight: Promise<void> | null = null
  private eagerStartRequested = false

  constructor(private readonly input: BackgroundRuntimeKernelInput) {
    this.controlReadyPromise = new Promise<void>((resolve) => {
      this.resolveControlReady = resolve
    })
  }

  markControlReady(): void {
    if (this.controlReady) return
    this.controlReady = true
    this.resolveControlReady()
  }

  async ensure(readiness: RuntimeMessageReadiness): Promise<void> {
    switch (readiness) {
      case "control-ready":
        await this.controlReadyPromise
        return
      case "queue-hydrated":
        await this.ensureQueueHydrated()
        return
      case "integrations-ready":
        await this.ensureIntegrationsReady()
        return
      case "runtime-ready":
        await this.ensureRuntimeReady()
    }
  }

  start(): void {
    this.eagerStartRequested = true
    void this.ensureRuntimeReady().catch(async (error) => {
      logger.error("Failed to initialize extension runtime", error)
      if (!(error instanceof RuntimePhaseError) || error.fatal) return

      try {
        await this.input.ensureLivenessAlarm()
      } catch (alarmError) {
        logger.warn(
          "Unable to schedule runtime initialization recovery",
          alarmError
        )
      }
    })
  }

  async refreshIntegrations(): Promise<void> {
    this.integrationPhase = {
      ...createPhaseState(),
      generation: this.integrationPhase.generation + 1,
    }
    await this.ensureIntegrationsReady()
  }

  getTabContextStateService(): TabContextStateService {
    if (!this.statePhase.completed || !this.tabContextStateService) {
      throw new RuntimePhaseError(
        "internal-state-ready",
        false,
        new Error("Tab context state is not ready")
      )
    }
    return this.tabContextStateService
  }

  private async ensureInternalStateReady(): Promise<void> {
    await this.runStickyPhase(
      "internal-state-ready",
      this.statePhase,
      async () => {
        await this.input.tabContextStateService.initialize()
        this.tabContextStateService = this.input.tabContextStateService
      }
    )
  }

  private async ensureQueueHydrated(): Promise<void> {
    await this.ensureInternalStateReady()
    await this.runStickyPhase("queue-hydrated", this.queuePhase, async () => {
      await this.input.queueRepository.initialize()
    })
  }

  private async ensureIntegrationsReady(): Promise<void> {
    await this.ensureInternalStateReady()
    const phase = this.integrationPhase
    if (phase.completed) return
    if (phase.fatalError) throw phase.fatalError
    if (phase.inFlight) return await phase.inFlight

    const attempt = (async () => {
      try {
        const { enablement } = await reconcileBroadHttpsPermissionEnablement(
          this.input.siteIntegrationEnablementService
        )
        if (this.integrationPhase !== phase) {
          await this.ensureIntegrationsReady()
          return
        }
        setEnablementMap(enablement)
        validateBackgroundSiteIntegrations()
        phase.completed = true
      } catch (error) {
        if (this.integrationPhase !== phase) {
          await this.ensureIntegrationsReady()
          return
        }
        const phaseError = this.toPhaseError("integrations-ready", error)
        if (phaseError.fatal) phase.fatalError = phaseError
        await this.publishFailureDiagnostic(phaseError)
        throw phaseError
      } finally {
        phase.inFlight = null
      }
    })()
    phase.inFlight = attempt
    await attempt
  }

  private async ensureRuntimeReady(): Promise<void> {
    await Promise.all([
      this.ensureQueueHydrated(),
      this.ensureIntegrationsReady(),
    ])
    await this.runStickyPhase("runtime-ready", this.runtimePhase, async () => {
      this.activation = await this.recoverRuntime()
    })
    await this.finishRuntimeReadiness()
  }

  private async finishRuntimeReadiness(): Promise<void> {
    while (true) {
      // A refresh can supersede the integration generation while runtime
      // recovery or final diagnostic publication is in flight. Do not publish
      // readiness or activate recovered work until one generation stays
      // current across the final awaited boundary.
      const phase = this.integrationPhase
      await this.ensureIntegrationsReady()
      if (this.integrationPhase !== phase) continue

      await this.publishSuccessDiagnostic()
      if (this.integrationPhase !== phase) continue

      if (this.eagerStartRequested) this.detachActivation()
      return
    }
  }

  private async recoverRuntime(): Promise<StartupQueueActivation | undefined> {
    await recoverPendingUndoActions(
      this.input.queueRepository,
      this.input.destinationService
    )
    await this.input.nativeOutputCoordinator.initialize()

    const startupRecovery = await initializeFromStorage({
      settingsRepository: this.input.settingsRepository,
      queueRepository: this.input.queueRepository,
      nativeOutputCoordinator: this.input.nativeOutputCoordinator,
      terminalCoordinator: this.input.terminalCoordinator,
      writeSession: async (values) => {
        await chrome.storage.session.set(values)
      },
      hasOffscreenDocument,
      terminateOffscreenDocumentForUnboundLease,
      getOffscreenJobState: queryOffscreenJob,
      setLivenessAlarmArmed: this.input.setLivenessAlarmArmed,
      getOffscreenActiveTaskIds: async () => {
        const status = await queryOffscreenStatus()
        if (status) return status.activeTaskIds
        if ((await getOffscreenContexts()).length === 0) return []
        throw new Error("Unable to query the existing offscreen document")
      },
    })

    try {
      await reconcileCompletedChapterHistory(startupRecovery.queue, {
        settingsRepository: this.input.settingsRepository,
        historyRepository: this.input.historyRepository,
      })
    } catch (error) {
      logger.warn(
        "Failed to reconcile completed chapter history during startup",
        error
      )
    }

    try {
      const settings = await this.input.settingsRepository.getSettings()
      await applyUiLanguagePreference(settings.uiLanguage)
      logger.debug(
        `[Init] Loading settings - defaultFormat: ${settings.downloads.defaultFormat}`
      )
    } catch (error) {
      logger.warn("Failed to project startup settings", error)
    }

    logger.info("Extension runtime initialized successfully")
    return startupRecovery.queueActivation
  }

  private detachActivation(): void {
    void this.activateQueue().catch((error) => {
      logger.error("Failed to activate the recovered download queue", error)
    })
  }

  private async activateQueue(): Promise<void> {
    if (this.activationCompleted || !this.activation) return
    if (this.activationInFlight) return await this.activationInFlight

    const activation = this.activation
    const attempt = (async () => {
      try {
        await this.input.queueScheduler.activateStartup(activation)
        this.activationCompleted = true
      } catch (error) {
        try {
          await this.input.ensureLivenessAlarm()
        } catch (alarmError) {
          logger.warn(
            "Unable to schedule queue activation recovery",
            alarmError
          )
        }
        throw error
      } finally {
        this.activationInFlight = null
      }
    })()
    this.activationInFlight = attempt
    await attempt
  }

  private async runStickyPhase(
    phaseName: BackgroundRuntimePhase,
    phase: PhaseState,
    operation: () => Promise<void>
  ): Promise<void> {
    if (phase.completed) return
    if (phase.fatalError) throw phase.fatalError
    if (phase.inFlight) return await phase.inFlight

    const attempt = (async () => {
      try {
        await operation()
        phase.completed = true
      } catch (error) {
        const phaseError = this.toPhaseError(phaseName, error)
        if (phaseError.fatal) phase.fatalError = phaseError
        await this.publishFailureDiagnostic(phaseError)
        throw phaseError
      } finally {
        phase.inFlight = null
      }
    })()
    phase.inFlight = attempt
    await attempt
  }

  private toPhaseError(
    phase: BackgroundRuntimePhase,
    error: unknown
  ): RuntimePhaseError {
    if (error instanceof RuntimePhaseError && error.phase === phase) {
      return error
    }
    return new RuntimePhaseError(
      phase,
      isFatalRuntimeInitializationError(error),
      error
    )
  }

  private async publishFailureDiagnostic(
    error: RuntimePhaseError
  ): Promise<void> {
    try {
      await chrome.storage.session.set({
        [SESSION_STORAGE_KEYS.initFailed]: true,
        [SESSION_STORAGE_KEYS.initError]: error.message,
      })
    } catch (diagnosticError) {
      logger.warn(
        "Unable to publish runtime failure diagnostic",
        diagnosticError
      )
    }
  }

  private async publishSuccessDiagnostic(): Promise<void> {
    try {
      await chrome.storage.session.set({
        [SESSION_STORAGE_KEYS.initFailed]: false,
        [SESSION_STORAGE_KEYS.initError]: null,
      })
    } catch (error) {
      logger.warn("Unable to clear runtime failure diagnostic", error)
    }
  }
}
