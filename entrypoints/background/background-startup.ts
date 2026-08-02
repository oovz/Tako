import logger from "@/src/runtime/logger"
import { applyUiLanguagePreference } from "@/src/runtime/i18n"
import { initializeBackgroundSiteIntegrations } from "@/src/runtime/background-site-integration-initialization"
import { settingsService } from "@/src/storage/settings-service"
import { settingsSyncService } from "@/src/storage/settings-sync-service"
import { createStateManager } from "@/entrypoints/background/state-action-router"
import { initializeFromStorage } from "@/entrypoints/background/initialize-from-storage"
import type { StartupQueueActivation } from "@/entrypoints/background/initialize-from-storage"
import {
  processDownloadQueue,
  resumeDownloadTask,
} from "@/entrypoints/background/download-queue"
import {
  getOffscreenContexts,
  hasOffscreenDocument,
  queryOffscreenJob,
  queryOffscreenStatus,
} from "@/entrypoints/background/offscreen-lifecycle"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { normalizePersistedDownloadTask } from "@/src/runtime/persisted-download-task"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import type { PendingDownloadsStore } from "@/entrypoints/background/pending-downloads"
import type {
  DownloadTaskState,
  PendingOutputRecord,
} from "@/src/types/queue-state"
import { reconcileBroadHttpsPermissionEnablement } from "@/src/site-integrations/host-permission-service"
import { activeDispatchLeaseStore } from "@/src/runtime/active-dispatch-lease"
import {
  mergePendingOutputAccountingIntoQueue,
  reconcileAllPendingOutputs,
} from "./native-output-finalizer"
import { recoverPendingUndoActions } from "./pending-undo-coordinator"
import { reconcileCompletedChapterHistory } from "./download-queue-finalization"
import { chapterPersistenceService } from "@/src/storage/chapter-persistence-service"

async function readPersistedDownloadQueue(): Promise<DownloadTaskState[]> {
  const result = await chrome.storage.local.get(
    LOCAL_STORAGE_KEYS.downloadQueue
  )
  const queue = result[LOCAL_STORAGE_KEYS.downloadQueue]
  return Array.isArray(queue)
    ? queue
        .map(normalizePersistedDownloadTask)
        .filter((task): task is DownloadTaskState => task !== null)
    : []
}

async function writePersistedDownloadQueue(
  queue: DownloadTaskState[]
): Promise<void> {
  await chrome.storage.local.set({ [LOCAL_STORAGE_KEYS.downloadQueue]: queue })
}

async function applyRecoveredQueue(
  stateManager: CentralizedStateManager,
  queue: DownloadTaskState[]
): Promise<void> {
  await stateManager.updateGlobalState({ downloadQueue: queue })
}

async function releaseSettledPendingOutputJobs(
  store: PendingDownloadsStore
): Promise<void> {
  const releasableJobIds = new Set(
    [...store.snapshot().values()]
      .filter(
        (record) =>
          record.state !== "prepared" &&
          record.state !== "in_progress" &&
          record.blobRevokedAt !== undefined
      )
      .map((record) => record.jobId)
  )
  for (const jobId of releasableJobIds) {
    try {
      await store.releaseJob(jobId)
    } catch (error) {
      logger.warn("Settled pending-output cleanup will be retried", {
        jobId,
        error,
      })
    }
  }
}

async function resumeRecoveredQueue(
  stateManager: CentralizedStateManager,
  ensureOffscreenDocumentReady: () => Promise<void>,
  activeTaskId?: string
): Promise<void> {
  if (activeTaskId) {
    await resumeDownloadTask(
      stateManager,
      activeTaskId,
      ensureOffscreenDocumentReady
    )
    return
  }
  await processDownloadQueue(stateManager, ensureOffscreenDocumentReady)
}

async function initializeSiteIntegrations(): Promise<void> {
  try {
    await reconcileBroadHttpsPermissionEnablement()
  } catch (error) {
    logger.warn(
      "Could not reconcile optional host permission during startup:",
      error
    )
  }
  await initializeBackgroundSiteIntegrations()
}

async function syncSettingsToState(
  stateManager: CentralizedStateManager
): Promise<void> {
  try {
    const settings = await settingsService.getSettings()
    await applyUiLanguagePreference(settings.uiLanguage)
    logger.debug(
      `[Init] Loading settings - defaultFormat: ${settings.downloads.defaultFormat}`
    )
    await stateManager.updateGlobalState({ settings })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn("Failed to sync settings to centralized state:", message)
  }
}

export interface InitializedBackgroundRuntime {
  stateManager: CentralizedStateManager
  activateQueue: () => Promise<void>
}

export interface BackgroundRuntimeInitialization {
  stateManager: CentralizedStateManager
  initialized: Promise<InitializedBackgroundRuntime>
}

interface BackgroundRuntimeInitializationInput {
  pendingDownloadsStore: PendingDownloadsStore
  ensureLivenessAlarm: () => Promise<void>
  setLivenessAlarmArmed?: (shouldArm: boolean) => Promise<void>
  ensureOffscreenDocumentReady: () => Promise<void>
  requestBlobRevocation: (
    record: Pick<
      PendingOutputRecord,
      "jobId" | "attempt" | "outputId" | "blobUrl"
    >
  ) => Promise<void>
}

function createQueueActivator(input: {
  activation?: StartupQueueActivation
  stateManager: CentralizedStateManager
  ensureOffscreenDocumentReady: () => Promise<void>
}): () => Promise<void> {
  let activationStarted = false

  return async () => {
    if (activationStarted || !input.activation) return
    activationStarted = true

    if (input.activation.kind === "resume-task") {
      await resumeRecoveredQueue(
        input.stateManager,
        input.ensureOffscreenDocumentReady,
        input.activation.taskId
      )
      return
    }

    await resumeRecoveredQueue(
      input.stateManager,
      input.ensureOffscreenDocumentReady
    )
  }
}

async function completeBackgroundRuntimeInitialization(
  input: BackgroundRuntimeInitializationInput,
  stateManager: CentralizedStateManager
): Promise<InitializedBackgroundRuntime> {
  try {
    await chapterPersistenceService.migrateLegacyDownloadHistory()

    await recoverPendingUndoActions(stateManager)

    await input.pendingDownloadsStore.hydrate()
    await reconcileAllPendingOutputs({
      stateManager,
      pendingOutputs: input.pendingDownloadsStore,
      requestBlobRevocation: input.requestBlobRevocation,
    })
    const persistedQueueWithOutputState = await readPersistedDownloadQueue()
    const recoveredOutputState = mergePendingOutputAccountingIntoQueue({
      queue: persistedQueueWithOutputState,
      records: input.pendingDownloadsStore.snapshot().values(),
    })
    if (recoveredOutputState.changed) {
      await writePersistedDownloadQueue(recoveredOutputState.queue)
    }
    // Accounting is now durable, so terminal records with released Blob URLs
    // no longer carry recovery information and can be removed safely.
    await releaseSettledPendingOutputJobs(input.pendingDownloadsStore)

    await initializeSiteIntegrations()

    const startupRecovery = await initializeFromStorage({
      readQueue: readPersistedDownloadQueue,
      writeQueue: writePersistedDownloadQueue,
      writeSession: async (values) => {
        await chrome.storage.session.set(values)
      },
      applyQueue: async (queue) => applyRecoveredQueue(stateManager, queue),
      getOffscreenContexts,
      hasOffscreenDocument,
      getOffscreenJobState: queryOffscreenJob,
      getActiveDispatchLease: () => activeDispatchLeaseStore.get(),
      clearActiveDispatchLease: (identity) =>
        activeDispatchLeaseStore.clear(identity),
      releasePendingOutputJob: (jobId) =>
        input.pendingDownloadsStore.releaseJob(jobId),
      hasReconcilablePendingOutputs: (task) =>
        [...input.pendingDownloadsStore.snapshot().values()].some((record) => {
          if (record.taskId !== task.id) return false
          if (record.state !== "prepared" && record.state !== "in_progress") {
            return false
          }
          const chapter = task.chapters.find(
            (candidate) => candidate.id === record.chapterId
          )
          return (
            chapter?.status === "downloading" &&
            chapter.dispatchAttempt === record.attempt
          )
        }),
      setLivenessAlarmArmed: input.setLivenessAlarmArmed,
      getOffscreenActiveTaskIds: async () => {
        const status = await queryOffscreenStatus()
        if (status) {
          return status.activeTaskIds
        }

        // The document may close after startup enumerates it but before the
        // status message is delivered. Only that confirmed disappearance is
        // equivalent to an idle offscreen context; a still-present document
        // with an invalid response remains a fail-closed recovery error.
        if ((await getOffscreenContexts()).length === 0) {
          return []
        }

        throw new Error("Unable to query the existing offscreen document")
      },
      ensureLivenessAlarm: input.ensureLivenessAlarm,
    })

    if (startupRecovery.initFailed) {
      throw new Error(
        startupRecovery.error ?? "Extension initialization failed"
      )
    }

    try {
      await reconcileCompletedChapterHistory(startupRecovery.queue)
    } catch (error) {
      // Downloaded history is a repairable projection of durable queue state.
      // Do not block the worker or tab context if a storage write fails; the
      // next startup will retry the same idempotent reconciliation.
      logger.warn(
        "Failed to reconcile completed chapter history during startup:",
        error
      )
    }

    await syncSettingsToState(stateManager)

    logger.info("Extension runtime initialized successfully")
    return {
      stateManager,
      activateQueue: createQueueActivator({
        activation: startupRecovery.queueActivation,
        stateManager,
        ensureOffscreenDocumentReady: input.ensureOffscreenDocumentReady,
      }),
    }
  } catch (error) {
    logger.error("Failed to initialize extension runtime:", error)
    throw error
  }
}

export async function beginBackgroundRuntimeInitialization(
  input: BackgroundRuntimeInitializationInput
): Promise<BackgroundRuntimeInitialization> {
  try {
    logger.info("Initializing extension runtime services and state...")

    settingsSyncService.initialize()

    const stateManager = await createStateManager()
    return {
      stateManager,
      initialized: completeBackgroundRuntimeInitialization(input, stateManager),
    }
  } catch (error) {
    logger.error("Failed to initialize extension runtime:", error)
    throw error
  }
}

export async function initializeBackgroundRuntime(
  input: BackgroundRuntimeInitializationInput
): Promise<InitializedBackgroundRuntime> {
  const initialization = await beginBackgroundRuntimeInitialization(input)
  return await initialization.initialized
}
