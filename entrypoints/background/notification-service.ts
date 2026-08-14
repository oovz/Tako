import logger from "@/src/runtime/logger"
import { getDisplayName } from "@/src/site-integrations/catalog"
import type { QueueRepository } from "@/src/storage/queue-repository"
import type {
  DestinationIssue,
  DestinationIssueKind,
  DownloadTaskState,
} from "@/src/domain/queue/state"

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

const DESTINATION_ISSUE_NOTIFICATION_PREFIX = "destination_issue_"

function getDestinationIssueMessage(kind: DestinationIssueKind): string {
  switch (kind) {
    case "fsa_permission_required":
      return "Grant access to the selected folder to continue the download."
    case "fsa_folder_missing":
      return "Choose the download folder again to continue."
    case "fsa_unsupported":
      return "This browser cannot use the selected custom folder."
    case "disk_full":
      return "The selected download folder does not have enough free space."
    case "fsa_write_failed":
      return "Tako could not write to the selected download folder."
  }
}

async function openDownloadsOptionsPage(): Promise<void> {
  const url = chrome.runtime.getURL("options.html?tab=downloads")
  const tabs = await chrome.tabs.query({
    url: chrome.runtime.getURL("options.html*"),
  })
  const existing = tabs[0]
  if (typeof existing?.id === "number") {
    await chrome.tabs.update(existing.id, { active: true, url })
    if (typeof existing.windowId === "number") {
      await chrome.windows.update(existing.windowId, { focused: true })
    }
    return
  }
  await chrome.tabs.create({ url, active: true })
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
    if (notificationId.startsWith(DESTINATION_ISSUE_NOTIFICATION_PREFIX)) {
      try {
        await openDownloadsOptionsPage()
      } catch (error) {
        logger.warn(
          "[NotificationService] Failed to open destination recovery options",
          error
        )
      }
      void chrome.notifications.clear(notificationId)
      return
    }

    const downloadId = await this.readPersistedDownloadId(
      notificationId,
      queueRepository
    )
    if (typeof downloadId === "number") {
      void chrome.downloads.show(downloadId)
    }

    void chrome.notifications.clear(notificationId)
  }

  notifyDestinationActionRequired(input: {
    issue: DestinationIssue
    notificationsEnabled: boolean
  }): void {
    if (!input.notificationsEnabled) return

    void chrome.notifications.create(
      `${DESTINATION_ISSUE_NOTIFICATION_PREFIX}${input.issue.id}`,
      {
        type: "basic",
        iconUrl: getIconUrl(),
        title: "Download folder needs attention",
        message: getDestinationIssueMessage(input.issue.kind),
        priority: 2,
        requireInteraction: true,
      }
    )
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

    await chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: getIconUrl(),
      title: "Download complete",
      message: `${task.seriesTitle}: ${completedCount}/${totalCount} chapters saved`,
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
