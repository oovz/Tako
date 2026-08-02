import logger from "@/src/runtime/logger"
import {
  ActionMessageSchema,
  OffscreenMessageSchema,
  type ActionMessage,
  type OffscreenMessage,
} from "@/src/runtime/message-schemas"
import {
  canonicalizeSettingsDocument,
  settingsService,
} from "@/src/storage/settings-service"
import { siteIntegrationEnablementService } from "@/src/storage/site-integration-enablement-service"
import { clearPersistentError } from "@/src/runtime/errors"
import {
  enqueueStartDownloadTask,
  processDownloadQueue,
  retryFailedChapters,
  restartTask,
  moveTaskToTop,
  clearAllHistory,
} from "@/entrypoints/background/download-queue"
import { processStateAction } from "@/entrypoints/background/state-action-router"
import { handleOffscreenDownloadProgress } from "@/entrypoints/background/offscreen-progress-handler"
import { resolveSiteIntegrationSeriesData } from "@/src/runtime/resolve-site-integration-series-data"
import {
  classifySenderOrigin,
  resolveSourceTabId,
  isSenderFromOptionsPage,
} from "@/entrypoints/background/sender-resolution"
import { StateAction } from "@/src/types/state-actions"
import type { CentralizedStateManager } from "@/src/runtime/centralized-state"
import type { PendingDownloadsStore } from "@/entrypoints/background/pending-downloads"
import type {
  ExtensionMessage,
  ExtensionMessageResponse,
} from "@/src/types/extension-messages"
import type {
  StateActionMessage,
  StateActionResponse,
} from "@/src/types/state-action-message"
import { applyUiLanguagePreference, t } from "@/src/runtime/i18n"
import { activeDispatchLeaseStore } from "@/src/runtime/active-dispatch-lease"
import { chapterPersistenceService } from "@/src/storage/chapter-persistence-service"
import type { PendingOutputRecord } from "@/src/types/queue-state"
import { runTaskSideEffectExclusive } from "./download-task-side-effect-gate"
import { executeIdempotentCommand } from "./command-idempotency"
import { handleOffscreenOutputReady } from "./offscreen-output-ready-handler"

const IDEMPOTENT_COMMAND_TYPES = new Set<ExtensionMessage["type"]>([
  "STATE_ACTION",
  "SYNC_SETTINGS_TO_STATE",
  "ACKNOWLEDGE_ERROR",
  "START_DOWNLOAD",
  "RETRY_FAILED_CHAPTERS",
  "RESTART_TASK",
  "MOVE_TASK_TO_TOP",
  "CLEAR_ALL_HISTORY",
  "CLEAR_PERSISTED_DOWNLOAD_HISTORY",
])

function readCommandId(message: ExtensionMessage): string | undefined {
  if (!IDEMPOTENT_COMMAND_TYPES.has(message.type)) return undefined
  const commandId = (message as { commandId?: unknown }).commandId
  return typeof commandId === "string" && commandId.length > 0
    ? commandId
    : undefined
}

export const offscreenOnlyMessages = [
  "OFFSCREEN_STATUS",
  "OFFSCREEN_CONTROL",
  "OFFSCREEN_QUERY_JOB",
  "OFFSCREEN_CANCEL_JOB",
  "REVOKE_BLOB_URL",
  "OFFSCREEN_DOWNLOAD_CHAPTER",
] as const satisfies ReadonlyArray<ExtensionMessage["type"]>

export const backgroundHandledMessages = new Set<ExtensionMessage["type"]>([
  "REQUEST_TAB_CONTEXT_REFRESH",
  "STATE_ACTION",
  "ACKNOWLEDGE_ERROR",
  "GET_SETTINGS",
  "GET_SITE_INTEGRATION_ENABLEMENT",
  "FETCH_SERIES_DATA",
  "SYNC_SETTINGS_TO_STATE",
  "OFFSCREEN_OUTPUT_READY",
  "OFFSCREEN_JOB_ACCEPTED",
  "OFFSCREEN_JOB_HEARTBEAT",
  "RETRY_FAILED_CHAPTERS",
  "RESTART_TASK",
  "MOVE_TASK_TO_TOP",
  "CLEAR_ALL_HISTORY",
  "CLEAR_PERSISTED_DOWNLOAD_HISTORY",
  "OPEN_OPTIONS",
  "START_DOWNLOAD",
  "OFFSCREEN_DOWNLOAD_PROGRESS",
])

interface BackgroundMessageRouterDependencies {
  ensureStateManagerInitialized: () => Promise<void>
  getStateManager: () => CentralizedStateManager
  ensureOffscreenDocumentReady: () => Promise<void>
  pendingDownloadsStore: PendingDownloadsStore
  requestBlobRevocation: (
    record: Pick<
      PendingOutputRecord,
      "jobId" | "attempt" | "outputId" | "blobUrl"
    >
  ) => Promise<void>
  tabContextResolver?: {
    resolveTabContext: (
      tabId: number,
      options?: { windowId?: number; allowCached?: boolean }
    ) => Promise<void>
  }
}

function parseActionMessage<TType extends ActionMessage["type"]>(
  message: ExtensionMessage,
  expectedType: TType
): Extract<ActionMessage, { type: TType }> | null {
  const parsed = ActionMessageSchema.safeParse(message)
  if (!parsed.success || parsed.data.type !== expectedType) {
    return null
  }

  return parsed.data as Extract<ActionMessage, { type: TType }>
}

function parseOffscreenMessage<TType extends OffscreenMessage["type"]>(
  message: ExtensionMessage,
  expectedType: TType
): Extract<OffscreenMessage, { type: TType }> | null {
  const parsed = OffscreenMessageSchema.safeParse(message)
  if (!parsed.success || parsed.data.type !== expectedType) {
    return null
  }

  return parsed.data as Extract<OffscreenMessage, { type: TType }>
}

function isOffscreenSender(sender: chrome.runtime.MessageSender): boolean {
  const extensionId =
    typeof chrome === "undefined" ? undefined : chrome.runtime?.id
  return classifySenderOrigin(sender, extensionId) === "offscreen"
}

const TASK_MANAGEMENT_ACTIONS = new Set<number>([
  StateAction.REMOVE_DOWNLOAD_TASK,
  StateAction.CANCEL_DOWNLOAD_TASK,
  StateAction.RETRY_DESTINATION_TASK,
  StateAction.CONTINUE_TASK_IN_DOWNLOADS,
  StateAction.UNDO_PENDING_ACTION,
])

function isExtensionPageSender(sender: chrome.runtime.MessageSender): boolean {
  const extensionId =
    typeof chrome === "undefined" ? undefined : chrome.runtime?.id
  return classifySenderOrigin(sender, extensionId) === "extension-page"
}

async function handleStateAction(
  message: StateActionMessage,
  sender: chrome.runtime.MessageSender | undefined,
  deps: BackgroundMessageRouterDependencies
): Promise<StateActionResponse> {
  try {
    if (
      TASK_MANAGEMENT_ACTIONS.has(message.action) &&
      sender &&
      !isExtensionPageSender(sender)
    ) {
      logger.warn(
        "Task-management state action rejected from non-extension-page sender",
        {
          action: message.action,
          senderUrl: sender.url,
        }
      )
      return {
        success: false,
        error: "Task-management actions are only accepted from extension pages",
      }
    }

    await deps.ensureStateManagerInitialized()
    const stateManager = deps.getStateManager()
    const executeAction = () =>
      processStateAction(stateManager, message, sender)
    const cancelTaskId =
      message.action === StateAction.CANCEL_DOWNLOAD_TASK &&
      typeof (message.payload as { taskId?: unknown })?.taskId === "string"
        ? (message.payload as { taskId: string }).taskId
        : undefined
    const result = cancelTaskId
      ? await runTaskSideEffectExclusive(cancelTaskId, executeAction)
      : await executeAction()

    if (
      result.success &&
      (message.action === StateAction.CANCEL_DOWNLOAD_TASK ||
        message.action === StateAction.RETRY_DESTINATION_TASK ||
        message.action === StateAction.CONTINUE_TASK_IN_DOWNLOADS ||
        message.action === StateAction.UNDO_PENDING_ACTION)
    ) {
      logger.info("Task action applied, processing queue immediately")
      await processDownloadQueue(
        stateManager,
        deps.ensureOffscreenDocumentReady
      )
    }

    if (result.success) {
      return { success: true, data: result.data }
    }

    return { success: false, error: result.error || "Unknown error" }
  } catch (error) {
    logger.error("Error in handleStateAction:", error)
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error"
    return { success: false, error: errorMessage }
  }
}

export async function handleBackgroundMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  deps: BackgroundMessageRouterDependencies,
  skipCommandDeduplication: boolean = false
): Promise<ExtensionMessageResponse | null> {
  const commandId = readCommandId(message)
  if (!skipCommandDeduplication && commandId) {
    return await executeIdempotentCommand({
      commandId,
      type: message.type,
      message,
      operation: () => handleBackgroundMessage(message, sender, deps, true),
    })
  }
  const { type } = message
  logger.debug("[background-message-router] Received message", {
    type,
    senderUrl: sender.url,
    senderTabId: sender.tab?.id,
  })

  try {
    switch (type) {
      case "REQUEST_TAB_CONTEXT_REFRESH": {
        const parsedMessage = parseActionMessage(
          message,
          "REQUEST_TAB_CONTEXT_REFRESH"
        )
        if (!parsedMessage) {
          return {
            success: false,
            error: "Invalid REQUEST_TAB_CONTEXT_REFRESH payload",
          }
        }

        const senderOrigin = classifySenderOrigin(
          sender,
          typeof chrome !== "undefined" ? chrome.runtime?.id : undefined
        )
        if (senderOrigin !== "extension-page") {
          return {
            success: false,
            error:
              "REQUEST_TAB_CONTEXT_REFRESH is only accepted from extension pages",
          }
        }

        const tabId = resolveSourceTabId(sender, parsedMessage.payload.tabId)
        if (typeof tabId !== "number") {
          return {
            success: false,
            error: "REQUEST_TAB_CONTEXT_REFRESH requires a target tab",
          }
        }
        if (
          typeof sender.tab?.id === "number" &&
          typeof parsedMessage.payload.tabId === "number" &&
          sender.tab.id !== parsedMessage.payload.tabId
        ) {
          return {
            success: false,
            error:
              "REQUEST_TAB_CONTEXT_REFRESH target tab did not match sender",
          }
        }

        const tab = await chrome.tabs.get(tabId)
        if (!tab.active) {
          return {
            success: false,
            error: "REQUEST_TAB_CONTEXT_REFRESH target tab is not active",
          }
        }
        if (
          typeof parsedMessage.payload.windowId === "number" &&
          tab.windowId !== parsedMessage.payload.windowId
        ) {
          return {
            success: false,
            error:
              "REQUEST_TAB_CONTEXT_REFRESH target window did not match tab",
          }
        }
        if (!deps.tabContextResolver) {
          return {
            success: false,
            error: "Tab context resolver is unavailable",
          }
        }

        await deps.ensureStateManagerInitialized()
        await deps.tabContextResolver.resolveTabContext(tabId, {
          windowId: tab.windowId,
          allowCached: false,
        })
        return { success: true }
      }
      case "STATE_ACTION": {
        const parsedMessage = parseActionMessage(message, "STATE_ACTION")
        if (!parsedMessage) {
          return {
            success: false,
            error: "Invalid STATE_ACTION message shape",
          }
        }
        return await handleStateAction(parsedMessage, sender, deps)
      }
      case "ACKNOWLEDGE_ERROR": {
        const parsedMessage = parseActionMessage(message, "ACKNOWLEDGE_ERROR")
        if (!parsedMessage) {
          return { success: false, error: "Invalid ACKNOWLEDGE_ERROR payload" }
        }

        try {
          await clearPersistentError(parsedMessage.payload.code)
        } catch (e) {
          logger.debug("ACKNOWLEDGE_ERROR failed (non-fatal)", e)
          return { success: false, error: "Failed to acknowledge error" }
        }
        return { success: true }
      }
      case "GET_SETTINGS": {
        try {
          const settings = await settingsService.getSettings()
          return { success: true, ...settings }
        } catch (e: unknown) {
          const message =
            e instanceof Error ? e.message : "Failed to load settings"
          return { success: false, error: message }
        }
      }
      case "GET_SITE_INTEGRATION_ENABLEMENT": {
        // Offscreen documents only have chrome.runtime; they proxy storage
        // reads through this handler. Background/content read storage directly.
        try {
          const enablement = await siteIntegrationEnablementService.getAll()
          return { success: true, enablement }
        } catch (e: unknown) {
          const message =
            e instanceof Error
              ? e.message
              : "Failed to load site integration enablement"
          logger.error("Error handling GET_SITE_INTEGRATION_ENABLEMENT:", e)
          return { success: false, error: message }
        }
      }
      case "FETCH_SERIES_DATA": {
        const parsedMessage = parseActionMessage(message, "FETCH_SERIES_DATA")
        if (!parsedMessage) {
          return { success: false, error: "Invalid FETCH_SERIES_DATA payload" }
        }

        try {
          const {
            siteIntegrationId,
            seriesId,
            seriesUrl,
            language,
            mangadexPreferences,
          } = parsedMessage.payload
          const result = await resolveSiteIntegrationSeriesData({
            siteIntegrationId,
            seriesId,
            seriesUrl,
            language,
            mangadexPreferences,
          })

          return {
            success: true,
            seriesId: result.seriesId,
            seriesMetadata: result.seriesMetadata,
            chapterList: result.chapterList,
            metadataError: result.metadataError,
            chapterListError: result.chapterListError,
            chapterListNotice: result.chapterListNotice,
          }
        } catch (e: unknown) {
          const errorMessage =
            e instanceof Error ? e.message : "Failed to fetch series data"
          logger.error("Error handling FETCH_SERIES_DATA:", e)
          return { success: false, error: errorMessage }
        }
      }
      case "SYNC_SETTINGS_TO_STATE": {
        const parsedMessage = parseActionMessage(
          message,
          "SYNC_SETTINGS_TO_STATE"
        )
        if (!parsedMessage) {
          return {
            success: false,
            error: "Invalid SYNC_SETTINGS_TO_STATE payload",
          }
        }

        try {
          const nextSettings = canonicalizeSettingsDocument(
            parsedMessage.payload.settings
          )
          if (!nextSettings) {
            return {
              success: false,
              error: "Invalid SYNC_SETTINGS_TO_STATE payload",
            }
          }

          await applyUiLanguagePreference(nextSettings.uiLanguage)
          await deps.ensureStateManagerInitialized()
          await deps
            .getStateManager()
            .updateGlobalState({ settings: nextSettings })
          return { success: true }
        } catch (e: unknown) {
          const message =
            e instanceof Error ? e.message : t("background_settingsSyncFailed")
          return { success: false, error: message }
        }
      }
      case "OFFSCREEN_JOB_ACCEPTED":
      case "OFFSCREEN_JOB_HEARTBEAT": {
        const parsedMessage = parseOffscreenMessage(message, type)
        if (!parsedMessage) {
          return { success: false, error: `Invalid ${type} payload` }
        }
        if (!isOffscreenSender(sender)) {
          return {
            success: false,
            error: `${type} is only accepted from offscreen`,
          }
        }
        const stage =
          parsedMessage.type === "OFFSCREEN_JOB_ACCEPTED"
            ? "accepted"
            : parsedMessage.payload.stage
        const activityAt =
          parsedMessage.type === "OFFSCREEN_JOB_ACCEPTED"
            ? parsedMessage.payload.acceptedAt
            : parsedMessage.payload.sentAt
        const renewed = await activeDispatchLeaseStore.renew({
          jobId: parsedMessage.payload.jobId,
          attempt: parsedMessage.payload.attempt,
          stage,
          sequence: parsedMessage.payload.sequence,
          activityAt,
        })
        return renewed
          ? { success: true }
          : { success: false, error: "Stale or unknown job identity" }
      }
      case "OFFSCREEN_OUTPUT_READY": {
        const parsedMessage = parseOffscreenMessage(
          message,
          "OFFSCREEN_OUTPUT_READY"
        )
        if (!parsedMessage) {
          return {
            success: false,
            error: "Invalid OFFSCREEN_OUTPUT_READY payload",
          }
        }

        if (!isOffscreenSender(sender)) {
          return {
            success: false,
            error:
              "OFFSCREEN_OUTPUT_READY is only accepted from the offscreen document",
          }
        }

        return await handleOffscreenOutputReady(parsedMessage, deps)
      }
      case "RETRY_FAILED_CHAPTERS": {
        const parsedMessage = parseActionMessage(
          message,
          "RETRY_FAILED_CHAPTERS"
        )
        if (!parsedMessage) {
          return { success: false, error: "Missing taskId" }
        }

        if (!isExtensionPageSender(sender)) {
          return {
            success: false,
            error:
              "RETRY_FAILED_CHAPTERS is only available from extension pages",
          }
        }

        await deps.ensureStateManagerInitialized()

        try {
          const result = await retryFailedChapters(
            deps.getStateManager(),
            parsedMessage.payload.taskId
          )
          if (!result.success) {
            return { success: false, error: result.reason || "Retry failed" }
          }

          await processDownloadQueue(
            deps.getStateManager(),
            deps.ensureOffscreenDocumentReady
          )
          return { success: true }
        } catch (e: unknown) {
          const errorMessage = e instanceof Error ? e.message : "Retry failed"
          logger.error("Error handling RETRY_FAILED_CHAPTERS:", e)
          return { success: false, error: errorMessage }
        }
      }
      case "RESTART_TASK": {
        const parsedMessage = parseActionMessage(message, "RESTART_TASK")
        if (!parsedMessage) {
          return { success: false, error: "Missing taskId" }
        }

        if (!isExtensionPageSender(sender)) {
          return {
            success: false,
            error: "RESTART_TASK is only available from extension pages",
          }
        }

        await deps.ensureStateManagerInitialized()

        try {
          const result = await restartTask(
            deps.getStateManager(),
            parsedMessage.payload.taskId
          )
          if (!result.success) {
            return { success: false, error: result.reason || "Restart failed" }
          }

          await processDownloadQueue(
            deps.getStateManager(),
            deps.ensureOffscreenDocumentReady
          )
          return { success: true }
        } catch (e: unknown) {
          const errorMessage = e instanceof Error ? e.message : "Restart failed"
          logger.error("Error handling RESTART_TASK:", e)
          return { success: false, error: errorMessage }
        }
      }
      case "MOVE_TASK_TO_TOP": {
        const parsedMessage = parseActionMessage(message, "MOVE_TASK_TO_TOP")
        if (!parsedMessage) {
          return { success: false, error: "Missing taskId" }
        }

        if (!isExtensionPageSender(sender)) {
          return {
            success: false,
            error: "MOVE_TASK_TO_TOP is only available from extension pages",
          }
        }

        await deps.ensureStateManagerInitialized()

        try {
          const result = await moveTaskToTop(
            deps.getStateManager(),
            parsedMessage.payload.taskId
          )
          if (!result.success) {
            return {
              success: false,
              error: result.reason || "Unable to move task to top",
            }
          }
          return { success: true }
        } catch (e: unknown) {
          const errorMessage =
            e instanceof Error ? e.message : "Unable to move task to top"
          logger.error("Error handling MOVE_TASK_TO_TOP:", e)
          return { success: false, error: errorMessage }
        }
      }
      case "CLEAR_ALL_HISTORY": {
        if (!parseActionMessage(message, "CLEAR_ALL_HISTORY")) {
          return { success: false, error: "Invalid CLEAR_ALL_HISTORY payload" }
        }

        const optionsUrlPrefix = chrome.runtime.getURL("options.html")
        if (!isSenderFromOptionsPage(sender, optionsUrlPrefix)) {
          return {
            success: false,
            error: "CLEAR_ALL_HISTORY is only available from Options page",
          }
        }

        await deps.ensureStateManagerInitialized()
        try {
          const result = await clearAllHistory(deps.getStateManager())
          return { success: true, removedCount: result.removedCount }
        } catch (e: unknown) {
          const errorMessage =
            e instanceof Error ? e.message : "Unable to clear history"
          logger.error("Error handling CLEAR_ALL_HISTORY:", e)
          return { success: false, error: errorMessage }
        }
      }
      case "CLEAR_PERSISTED_DOWNLOAD_HISTORY": {
        const parsedMessage = parseActionMessage(
          message,
          "CLEAR_PERSISTED_DOWNLOAD_HISTORY"
        )
        if (!parsedMessage) {
          return {
            success: false,
            error: "Invalid CLEAR_PERSISTED_DOWNLOAD_HISTORY payload",
          }
        }

        const optionsUrlPrefix = chrome.runtime.getURL("options.html")
        if (!isSenderFromOptionsPage(sender, optionsUrlPrefix)) {
          return {
            success: false,
            error:
              "CLEAR_PERSISTED_DOWNLOAD_HISTORY is only available from Options page",
          }
        }

        try {
          if (parsedMessage.payload.scope === "all") {
            await chapterPersistenceService.clearAllDownloadHistory()
          } else {
            await chapterPersistenceService.clearSeriesDownloadHistory(
              parsedMessage.payload.siteIntegrationId,
              parsedMessage.payload.seriesId
            )
          }
          return { success: true }
        } catch (e: unknown) {
          const errorMessage =
            e instanceof Error ? e.message : "Unable to clear download history"
          logger.error("Error handling CLEAR_PERSISTED_DOWNLOAD_HISTORY:", e)
          return { success: false, error: errorMessage }
        }
      }
      case "OPEN_OPTIONS": {
        const parsedMessage = parseActionMessage(message, "OPEN_OPTIONS")
        if (!parsedMessage) {
          return { success: false, error: "Invalid OPEN_OPTIONS payload" }
        }

        const page = parsedMessage.payload.page
        const tabParam = page ? `?tab=${encodeURIComponent(page)}` : ""
        const url = chrome.runtime.getURL(`options.html${tabParam}`)

        try {
          const tabs = await chrome.tabs.query({
            url: chrome.runtime.getURL("options.html*"),
          })
          const existing = tabs[0]
          if (typeof existing?.id === "number") {
            await chrome.tabs.update(existing.id, { active: true, url })
            if (typeof existing.windowId === "number") {
              await chrome.windows.update(existing.windowId, { focused: true })
            }
          } else {
            await chrome.tabs.create({ url, active: true })
          }

          return { success: true }
        } catch (e: unknown) {
          const errorMessage =
            e instanceof Error ? e.message : "Failed to open options page"
          logger.error("Error handling OPEN_OPTIONS:", e)
          return { success: false, error: errorMessage }
        }
      }
      case "START_DOWNLOAD": {
        const parsedMessage = parseActionMessage(message, "START_DOWNLOAD")
        if (!parsedMessage) {
          return { success: false, error: "Invalid START_DOWNLOAD payload" }
        }

        if (
          classifySenderOrigin(sender, chrome.runtime.id) !== "extension-page"
        ) {
          return {
            success: false,
            error: "START_DOWNLOAD is only accepted from extension pages",
          }
        }

        await deps.ensureStateManagerInitialized()
        const sourceTabId = resolveSourceTabId(
          sender,
          parsedMessage.payload.sourceTabId
        )

        if (typeof sourceTabId !== "number") {
          return {
            success: false,
            error: "Unable to resolve sender tab for START_DOWNLOAD",
          }
        }

        const result = await enqueueStartDownloadTask(
          deps.getStateManager(),
          parsedMessage.payload,
          sourceTabId
        )

        if (!result.success || !result.taskId) {
          return {
            success: false,
            error: result.reason || "Failed to enqueue download task",
          }
        }

        void processDownloadQueue(
          deps.getStateManager(),
          deps.ensureOffscreenDocumentReady
        ).catch((error) => {
          logger.error(
            "Failed to process download queue after START_DOWNLOAD:",
            error
          )
        })

        return { success: true, taskId: result.taskId }
      }
      case "OFFSCREEN_DOWNLOAD_PROGRESS": {
        const parsedMessage = parseOffscreenMessage(
          message,
          "OFFSCREEN_DOWNLOAD_PROGRESS"
        )
        if (!parsedMessage) {
          return {
            success: false,
            error: "Invalid OFFSCREEN_DOWNLOAD_PROGRESS payload",
          }
        }

        if (!isOffscreenSender(sender)) {
          return {
            success: false,
            error:
              "OFFSCREEN_DOWNLOAD_PROGRESS is only accepted from the offscreen document",
          }
        }

        await deps.ensureStateManagerInitialized()
        return await handleOffscreenDownloadProgress(
          deps.getStateManager(),
          parsedMessage
        )
      }
      default:
        logger.debug(`Background ignoring message type: ${type}`)
        return null
    }
  } catch (error) {
    logger.error(`Error handling message ${type}:`, error)
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error"
    return { success: false, error: errorMessage }
  }
}
