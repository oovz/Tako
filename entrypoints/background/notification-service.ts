import { t } from "@/src/runtime/i18n"
import {
  getCompletedOutputDestination,
  getCompletedSaveConfirmedAt,
  getOutputResultLabel,
} from "@/src/runtime/output-result-presentation"
import logger from "@/src/runtime/logger"
import { getDisplayName } from "@/src/site-integrations/catalog"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type { DownloadTaskState } from "@/src/domain/queue/state"

interface TaskCompletionNotificationInput {
  task: DownloadTaskState
  notificationsEnabled: boolean
  chaptersCompleted?: number
  chaptersTotal?: number
}

interface DownloadCompleteNotificationData {
  task: DownloadTaskState
  notificationsEnabled: boolean
  chaptersCompleted?: number
  chaptersTotal?: number
}

interface TaskFailureNotificationInput {
  task: DownloadTaskState
  notificationsEnabled: boolean
  errorMessage?: string
}

function getIconUrl(): string {
  return chrome.runtime.getURL("icon/128.png")
}

function extractTaskId(notificationId: string): string | null {
  if (notificationId.startsWith("task_complete_")) {
    return notificationId.slice("task_complete_".length)
  }

  if (notificationId.startsWith("task_error_")) {
    return notificationId.slice("task_error_".length)
  }

  return null
}

export class NotificationService {
  async showDownloadCompleteNotification(
    data: DownloadCompleteNotificationData
  ): Promise<void> {
    await this.notifyTaskCompleted(data)
  }

  async handleNotificationClick(
    notificationId: string,
    queueRepository: QueueRepository
  ): Promise<void> {
    const downloadId = await this.readPersistedDownloadId(
      notificationId,
      queueRepository
    )
    if (typeof downloadId === "number") {
      void chrome.downloads.show(downloadId)
    }

    void chrome.notifications.clear(notificationId)
  }

  private async readPersistedDownloadId(
    notificationId: string,
    queueRepository: QueueRepository
  ): Promise<number | undefined> {
    const taskId = extractTaskId(notificationId)
    if (!taskId) {
      return undefined
    }

    try {
      const task = await queueRepository.getTask(taskId)

      return typeof task?.lastSuccessfulDownloadId === "number"
        ? task.lastSuccessfulDownloadId
        : undefined
    } catch (error) {
      logger.debug(
        "[NotificationService] Failed to resolve persisted notification click target",
        {
          notificationId,
          error,
        }
      )
      return undefined
    }
  }

  async notifyTaskCompleted({
    task,
    notificationsEnabled,
    chaptersCompleted,
    chaptersTotal,
  }: TaskCompletionNotificationInput): Promise<void> {
    if (!notificationsEnabled) {
      return
    }

    const notificationId = `task_complete_${task.id}`
    const totalCount = chaptersTotal ?? task.chapters.length
    const completedCount =
      chaptersCompleted ??
      (task.chapters.filter((chapter) => chapter.status === "completed")
        .length ||
        totalCount)

    const destination = getCompletedOutputDestination(task.chapters)
    const chapterCount = t("options_chaptersCount", [
      String(completedCount),
      String(totalCount),
    ])
    const saveConfirmedAt = getCompletedSaveConfirmedAt(task.chapters)
    const saveGuidance =
      saveConfirmedAt === undefined
        ? `\n${t("output_saveUnconfirmedDescription")}`
        : ""

    await chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: getIconUrl(),
      title: getOutputResultLabel(destination, saveConfirmedAt),
      message: `${task.seriesTitle}: ${chapterCount}${saveGuidance}`,
      contextMessage: getDisplayName(task.siteIntegrationId),
      priority: 1,
      requireInteraction: false,
    })
  }

  async notifyTaskFailed({
    task,
    notificationsEnabled,
    errorMessage,
  }: TaskFailureNotificationInput): Promise<void> {
    if (!notificationsEnabled) {
      return
    }

    const notificationId = `task_error_${task.id}`
    const failedCount = task.chapters.filter(
      (chapter) =>
        chapter.status === "failed" || chapter.status === "partial_success"
    ).length

    await chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: getIconUrl(),
      title:
        task.status === "partial_success"
          ? "Download partially complete"
          : "Download failed",
      message: `${task.seriesTitle}: ${failedCount}/${task.chapters.length} chapters failed`,
      contextMessage: getDisplayName(task.siteIntegrationId),
      priority: 2,
      requireInteraction: false,
    })

    if (errorMessage) {
      logger.warn("[NotificationService] Task failure details", {
        taskId: task.id,
        errorMessage,
      })
    }
  }
}

let notificationService: NotificationService | null = null

export function getNotificationService(): NotificationService {
  if (!notificationService) {
    notificationService = new NotificationService()
  }

  return notificationService
}
