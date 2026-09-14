import { defineBackground } from "wxt/utils/define-background"

import logger from "@/src/runtime/logger"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import { createRuntimeMessageListener } from "@/src/runtime/runtime-message-dispatcher"
import { classifyRuntimeMessagePrincipal } from "@/src/runtime/runtime-message-sender"
import { QueueRepository } from "@/src/storage/queue-repository"
import { HistoryRepository } from "@/src/storage/history-repository"
import { HistoryQueryService } from "@/src/storage/history-query-service"
import { SettingsRepository } from "@/src/storage/settings-repository"
import { OptionsConfigurationRepository } from "@/src/storage/options-configuration-repository"
import {
  SettingsSubscriber,
  applySettingsSideEffects,
} from "@/src/storage/settings-subscriber"
import { SiteOverridesService } from "@/src/storage/site-overrides-service"
import { SiteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"
import { SiteIntegrationSettingsService } from "@/src/storage/site-integration-settings-service"
import { NativeOutputRepository } from "@/src/storage/native-output-repository"
import { QueueProjectionService } from "@/src/storage/queue-projection-service"
import { registerHistoryRepositoryListener } from "@/src/storage/history-repository-listener"
import {
  RateLimitService,
  StorageRateLimitPolicySource,
} from "@/src/runtime/rate-limit"
import { registerSiteIntegrationEnablementListener } from "@/src/runtime/site-integration-initialization"
import { getDefinition } from "@/src/site-integrations/catalog"
import { includesManagedHostPermission } from "@/src/site-integrations/host-permission-service"
import { SiteIntegrationSessionRuleManager } from "@/src/site-integrations/session-rule-manager"
import { configureSeriesDataOffscreenLifecycle } from "@/src/runtime/resolve-series-data-offscreen"
import { migrateDurableStateForCurrentSchema } from "@/src/runtime/state-schema-migration"
import { SESSION_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import type { NativeOutputRecord } from "@/src/domain/native-output/state"

import { BackgroundRuntimeKernel } from "@/entrypoints/background/background-runtime-kernel"
import { createBackgroundRuntimeMessageHandlers } from "@/entrypoints/background/background-runtime-message-handlers"
import { registerBackgroundNavigationListeners } from "@/entrypoints/background/background-navigation-listeners"
import { registerBackgroundRuntimeListeners } from "@/entrypoints/background/background-runtime-listeners"
import {
  ensureOffscreenDocumentReady,
  ensureLivenessAlarm,
  LIVENESS_ALARM_NAME,
  queryOffscreenJob,
  runOffscreenDocumentAdmissionExclusive,
  scheduleOffscreenCloseIfIdle,
  setLivenessAlarmArmed,
} from "@/entrypoints/background/offscreen-lifecycle"
import { NativeOutputCoordinator } from "@/entrypoints/background/native-output-coordinator"
import { tabContextCache } from "@/entrypoints/background/tab-cache"
import { TabContextStateService } from "@/entrypoints/background/tab-context-state-service"
import { createTabUiCoordinator } from "@/entrypoints/background/tab-ui-coordinator"
import { createTabContextResolver } from "@/entrypoints/background/tab-context-resolver"
import { getNotificationService } from "@/entrypoints/background/notification-service"
import { registerE2EStateSeedListener } from "@/entrypoints/background/e2e-state-seed"
import { QueueApplicationCommands } from "@/entrypoints/background/queue-application-commands"
import { BackgroundDownloadStateQueryService } from "@/entrypoints/background/download-state-query-service"
import { DownloadTaskCancellationCoordinator } from "@/entrypoints/background/download-task-cancellation-coordinator"
import { DownloadTaskExecutor } from "@/entrypoints/background/download-task-executor"
import { QueueScheduler } from "@/entrypoints/background/queue-scheduler"
import { OffscreenJobTerminalCoordinator } from "@/entrypoints/background/offscreen-job-terminal-coordinator"
import { ProviderPolicyQueueCoordinator } from "@/entrypoints/background/provider-policy-queue-coordinator"
import { ChapterDispatchCoordinator } from "@/entrypoints/background/chapter-dispatch-coordinator"
import { OptionsConfigurationService } from "@/entrypoints/background/options-configuration-service"
import { DestinationService } from "@/entrypoints/background/destination"

configureSeriesDataOffscreenLifecycle(runOffscreenDocumentAdmissionExclusive)

const settingsRepository = new SettingsRepository(
  ((import.meta as { env?: { DEV?: boolean } }).env?.DEV ?? false)
    ? "debug"
    : "warn"
)
const historyRepository = new HistoryRepository()
const historyQueryService = new HistoryQueryService(historyRepository)
const siteOverridesService = new SiteOverridesService()
const siteIntegrationEnablementService = new SiteIntegrationEnablementService()
const siteIntegrationSettingsService = new SiteIntegrationSettingsService()
const settingsSubscriber = new SettingsSubscriber(settingsRepository)
const rateLimitPolicySource = new StorageRateLimitPolicySource({
  settingsReader: settingsRepository,
  overridesReader: siteOverridesService,
  getSiteDefaults: (integrationId, scope) =>
    getDefinition(integrationId)?.policyDefaults?.[scope],
})
const rateLimitService = new RateLimitService(rateLimitPolicySource)
const siteIntegrationSessionRuleManager = new SiteIntegrationSessionRuleManager(
  {
    service: siteIntegrationEnablementService,
    awaitSchemaMigration,
    onReconciliationSucceeded: async (enablement) => {
      try {
        await runtimeKernel.ensure("runtime-ready")
        if (
          await providerPolicyQueueCoordinator.failDisabledTasks(enablement)
        ) {
          await queueScheduler.activate()
        }
        if (await providerPolicyQueueCoordinator.resumeBlockedQueue()) {
          await queueScheduler.activate()
        }
      } catch (error) {
        await ensureLivenessAlarm()
        throw error
      }
    },
  }
)
const finalizationDependencies = {
  settingsRepository,
  historyRepository,
}

const queueProjectionService = new QueueProjectionService()
const queueRepository = new QueueRepository(queueProjectionService)
const destinationService = new DestinationService({
  queueRepository,
  settingsReader: settingsRepository,
  notifier: getNotificationService(),
})
const downloadStateQueryService = new BackgroundDownloadStateQueryService(
  queueRepository,
  historyQueryService
)
const nativeOutputRepository = new NativeOutputRepository()
const tabUiCoordinator = createTabUiCoordinator()
const tabContextStateService = new TabContextStateService(tabContextCache)
const optionsConfigurationService = new OptionsConfigurationService({
  configurationRepository: new OptionsConfigurationRepository(
    {
      get: (keys) => chrome.storage.local.get(keys),
      set: (values) => chrome.storage.local.set(values),
    },
    settingsRepository
  ),
  settingsRepository,
  historyRepository,
  applySettingsSideEffects,
  cleanupRateLimiters: () => rateLimitService.cleanupRateLimiters(),
})
async function requestBlobRevocation(
  record: Pick<
    NativeOutputRecord,
    | "jobId"
    | "attempt"
    | "taskId"
    | "chapterId"
    | "fingerprint"
    | "documentInstanceId"
    | "outputId"
    | "blobUrl"
  >
): Promise<void> {
  const response = await sendRuntimeMessage({
    target: "offscreen",
    type: "REVOKE_BLOB_URL",
    payload: {
      jobId: record.jobId,
      attempt: record.attempt,
      taskId: record.taskId,
      chapterId: record.chapterId,
      fingerprint: record.fingerprint,
      documentInstanceId: record.documentInstanceId,
      outputId: record.outputId,
      blobUrl: record.blobUrl,
    },
  })
  if (!response.success) throw new Error(response.error)
}

const nativeOutputCoordinator = new NativeOutputCoordinator({
  settingsRepository,
  repository: nativeOutputRepository,
  queueRepository,
  queryOffscreenJob,
  requestBlobRevocation,
  ensureLivenessAlarm,
})

const cancellationCoordinator = new DownloadTaskCancellationCoordinator(
  queueRepository,
  nativeOutputCoordinator,
  finalizationDependencies
)

const providerPolicyQueueCoordinator = new ProviderPolicyQueueCoordinator(
  queueRepository,
  nativeOutputCoordinator,
  cancellationCoordinator,
  siteIntegrationSessionRuleManager.continuationCoordinator
)

const chapterDispatchCoordinator = new ChapterDispatchCoordinator(
  queueRepository,
  runOffscreenDocumentAdmissionExclusive,
  cancellationCoordinator,
  siteIntegrationSessionRuleManager,
  destinationService,
  siteIntegrationEnablementService,
  siteIntegrationSettingsService
)

const taskExecutor = new DownloadTaskExecutor(
  queueRepository,
  ensureOffscreenDocumentReady,
  cancellationCoordinator,
  providerPolicyQueueCoordinator,
  chapterDispatchCoordinator,
  siteIntegrationSessionRuleManager,
  destinationService,
  siteIntegrationEnablementService,
  finalizationDependencies
)
const queueScheduler = new QueueScheduler(
  queueRepository,
  taskExecutor,
  async () => {
    await scheduleOffscreenCloseIfIdle(queueRepository, nativeOutputCoordinator)
    await setLivenessAlarmArmed(
      await nativeOutputCoordinator.hasReconcilableLiveDependencies()
    )
  }
)
const terminalCoordinator = new OffscreenJobTerminalCoordinator(
  queueRepository,
  nativeOutputCoordinator,
  queueScheduler,
  destinationService,
  finalizationDependencies
)

/**
 * One-time durable-state migration gate. The promise is
 * created inside `main()` (the only context guaranteed to have `chrome`);
 * every readiness phase and the DNR manager await the SAME gate through
 * `awaitSchemaMigration()`. A rejected migration is sticky and fatal.
 */
const schemaMigrationGate: { promise: Promise<void> | null } = { promise: null }

function awaitSchemaMigration(): Promise<void> {
  return schemaMigrationGate.promise ?? Promise.resolve()
}

const runtimeKernel = new BackgroundRuntimeKernel({
  settingsRepository,
  siteIntegrationEnablementService,
  tabContextStateService,
  queueRepository,
  historyRepository,
  nativeOutputCoordinator,
  terminalCoordinator,
  ensureLivenessAlarm,
  setLivenessAlarmArmed,
  queueScheduler,
  awaitSchemaMigration,
})

const tabContextResolver = createTabContextResolver({
  getTabContextStateService: () => runtimeKernel.getTabContextStateService(),
  tabContextCache,
  beforeResolution: () => runtimeKernel.ensure("integrations-ready"),
  beforeStateMutation: () => runtimeKernel.ensure("integrations-ready"),
  rateLimitService,
  siteIntegrationSettingsReader: siteIntegrationSettingsService,
})

const queueApplicationCommands = new QueueApplicationCommands({
  queueRepository,
  nativeOutputCoordinator,
  terminalCoordinator,
  cancellationCoordinator,
  queueScheduler,
  startDownloadSettings: {
    settingsRepository,
    siteIntegrationSettingsService,
    siteOverridesService,
  },
  siteIntegrationEnablementService,
  getCurrentSeriesContext:
    tabContextCache.getCurrentSeriesContext.bind(tabContextCache),
})

const backgroundRuntimeHandlers = createBackgroundRuntimeMessageHandlers({
  settingsRepository,
  historyRepository,
  siteIntegrationEnablementService,
  queueRepository,
  queueApplicationCommands,
  nativeOutputCoordinator,
  terminalCoordinator,
  downloadStateQueryService,
  optionsConfigurationService,
  ensureOffscreenDocumentReady,
  tabContextResolver,
})

const backgroundRuntimeMessageListener = createRuntimeMessageListener({
  target: "background",
  handlers: backgroundRuntimeHandlers,
  classifySender: (sender) =>
    classifyRuntimeMessagePrincipal(sender, chrome.runtime.id),
  waitForReadiness: (readiness) => runtimeKernel.ensure(readiness),
  reportError: (message, error) => logger.error(message, error),
})

async function reconcileIntegrationSupportAfterPermissionRemoval(): Promise<void> {
  await runtimeKernel.refreshIntegrations()
  await runtimeKernel.ensure("runtime-ready")

  const tabs = await chrome.tabs.query({})
  const outcomes = await Promise.allSettled(
    tabs.flatMap((tab) => {
      if (typeof tab.id !== "number") return []
      const url = tab.url ?? tab.pendingUrl ?? ""
      const refreshes: Promise<unknown>[] = [
        tabUiCoordinator.updateActionForTab(tab.id, url),
        tabUiCoordinator.updateSidePanelForTab(tab.id),
      ]
      if (tab.active) {
        refreshes.push(
          tabContextResolver.resolveTabContext(tab.id, {
            windowId: tab.windowId,
            allowCached: false,
          })
        )
      }
      return refreshes
    })
  )
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      logger.debug(
        "Failed to refresh tab support after permission removal",
        outcome.reason
      )
    }
  }
}

export default defineBackground({
  type: "module",
  main() {
    logger.info("Background script starting")

    // Event listeners are registered synchronously below. Versioned state
    // migration then runs before any repository hydrates or the kernel starts.
    try {
      chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((error) => {
          logger.debug("sidePanel.setPanelBehavior failed", error)
        })
    } catch (error) {
      logger.debug("sidePanel.setPanelBehavior unavailable", error)
    }

    chrome.runtime.onMessage.addListener(backgroundRuntimeMessageListener)
    settingsSubscriber.register()
    registerHistoryRepositoryListener(historyRepository)
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return
      if (
        Object.hasOwn(changes, "settings:global") ||
        Object.hasOwn(changes, "siteOverrides")
      ) {
        rateLimitService.cleanupRateLimiters()
      }
    })
    registerSiteIntegrationEnablementListener(siteIntegrationEnablementService)

    registerBackgroundRuntimeListeners({
      waitForReadiness: (readiness) => runtimeKernel.ensure(readiness),
      getTabContextStateService: () =>
        runtimeKernel.getTabContextStateService(),
      queueRepository,
      nativeOutputCoordinator,
      queueScheduler,
      terminalCoordinator,
      providerPolicyQueueCoordinator,
      tabContextCache,
      ensureLivenessAlarm,
      livenessAlarmName: LIVENESS_ALARM_NAME,
      settingsRepository,
    })

    if (__TAKO_E2E_STATE_SEED__) {
      registerE2EStateSeedListener({
        ensureRuntimeReady: () => runtimeKernel.ensure("runtime-ready"),
        getTabContextStateService: () =>
          runtimeKernel.getTabContextStateService(),
        cancelTabContextResolution: (tabId) =>
          tabContextResolver.cancelTabContextResolution(tabId),
        queueRepository,
        siteIntegrationEnablementService,
      })
    }

    registerBackgroundNavigationListeners({
      ensureIntegrationsReady: () => runtimeKernel.ensure("integrations-ready"),
      getTabContextStateService: () =>
        runtimeKernel.getTabContextStateService(),
      tabContextCache,
      tabContextResolver,
      tabUiCoordinator,
    })

    chrome.notifications.onClicked.addListener((notificationId) => {
      void runtimeKernel
        .ensure("queue-hydrated")
        .then(() =>
          getNotificationService().handleNotificationClick(
            notificationId,
            queueRepository
          )
        )
        .catch((error) => {
          logger.error("Failed to handle notification click", error)
        })
    })

    chrome.permissions.onRemoved.addListener((permissions) => {
      if (!includesManagedHostPermission(permissions)) return
      void reconcileIntegrationSupportAfterPermissionRemoval().catch(
        (error) => {
          logger.error(
            "Failed to reconcile integration enablement after permission removal",
            error
          )
        }
      )
    })

    siteIntegrationSessionRuleManager.registerListeners()

    // The migration promise is created HERE, in the service-worker runtime, so
    // build-time module evaluation (which has no `chrome`) never executes it.
    schemaMigrationGate.promise = migrateDurableStateForCurrentSchema()
    void schemaMigrationGate.promise.catch(() => undefined)

    void (async () => {
      try {
        // Migrate retained state before strict repositories hydrate it.
        await schemaMigrationGate.promise
      } catch (error) {
        logger.error(
          "Refusing to initialize: retained durable state could not be migrated",
          error
        )
        try {
          await chrome.storage.session.set({
            [SESSION_STORAGE_KEYS.initFailed]: true,
            [SESSION_STORAGE_KEYS.initError]:
              "Retained state could not be migrated; restart the extension to retry.",
          })
        } catch (diagnosticError) {
          logger.warn(
            "Unable to publish the schema-migration failure diagnostic",
            diagnosticError
          )
        }
        return
      }

      // Initial DNR reconciliation and its enablement/continuation reads must
      // not run against pre-migration storage.
      const initialSessionRuleReconciliation =
        siteIntegrationSessionRuleManager.start()
      void initialSessionRuleReconciliation.catch((error) => {
        logger.warn("Initial provider session DNR reconciliation failed", error)
      })

      runtimeKernel.markControlReady()
      runtimeKernel.start()
    })()
    logger.info("Background script initialized")
  },
})
