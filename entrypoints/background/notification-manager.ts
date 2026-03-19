import logger from '@/src/runtime/logger';
import { LOCAL_STORAGE_KEYS } from '@/src/runtime/storage-keys';
import { getSiteIntegrationDisplayName } from '@/src/site-integrations/manifest';
import type { DownloadTaskState } from '@/src/types/queue-state';

interface TaskCompletionNotificationInput {
  task: DownloadTaskState;
  notificationsEnabled: boolean;
  chaptersCompleted?: number;
  chaptersTotal?: number;
}

interface DownloadCompleteNotificationData {
  task: DownloadTaskState;
  notificationsEnabled: boolean;
  chaptersCompleted?: number;
  chaptersTotal?: number;
}

interface TaskFailureNotificationInput {
  task: DownloadTaskState;
  notificationsEnabled: boolean;
  errorMessage?: string;
}

function getIconUrl(): string {
  return chrome.runtime.getURL('icon/128.png');
}

function extractTaskId(notificationId: string): string | null {
  if (notificationId.startsWith('task_complete_')) {
    return notificationId.slice('task_complete_'.length);
  }

  if (notificationId.startsWith('task_error_')) {
    return notificationId.slice('task_error_'.length);
  }

  return null;
}

export class NotificationManager {
  constructor() {
    this.registerClickHandler();
  }

  showDownloadCompleteNotification(data: DownloadCompleteNotificationData): void {
    this.notifyTaskCompleted(data);
  }

  private registerClickHandler(): void {
    chrome.notifications.onClicked.addListener((notificationId) => {
      void this.handleNotificationClick(notificationId);
    });
  }

  private async handleNotificationClick(notificationId: string): Promise<void> {
    const downloadId = await this.readPersistedDownloadId(notificationId);
    if (typeof downloadId === 'number') {
      void chrome.downloads.show(downloadId);
    }

    void chrome.notifications.clear(notificationId);
  }

  private async readPersistedDownloadId(notificationId: string): Promise<number | undefined> {
    const taskId = extractTaskId(notificationId);
    if (!taskId) {
      return undefined;
    }

    try {
      const result = await chrome.storage.local.get(LOCAL_STORAGE_KEYS.downloadQueue) as Record<string, unknown>;
      const queue = result[LOCAL_STORAGE_KEYS.downloadQueue];
      if (!Array.isArray(queue)) {
        return undefined;
      }

      const task = queue.find((entry) => {
        if (typeof entry !== 'object' || entry === null) {
          return false;
        }

        return 'id' in entry && (entry as { id?: unknown }).id === taskId;
      }) as { lastSuccessfulDownloadId?: unknown } | undefined;

      return typeof task?.lastSuccessfulDownloadId === 'number'
        ? task.lastSuccessfulDownloadId
        : undefined;
    } catch (error) {
      logger.debug('[NotificationManager] Failed to resolve persisted notification click target', {
        notificationId,
        error,
      });
      return undefined;
    }
  }

  notifyTaskCompleted({ task, notificationsEnabled, chaptersCompleted, chaptersTotal }: TaskCompletionNotificationInput): void {
    if (!notificationsEnabled) {
      return;
    }

    const notificationId = `task_complete_${task.id}`;
    const totalCount = chaptersTotal ?? task.chapters.length;
    const completedCount =
      chaptersCompleted ?? (task.chapters.filter((chapter) => chapter.status === 'completed').length || totalCount);

    chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: getIconUrl(),
      title: 'Download complete',
      message: `${task.seriesTitle}: ${completedCount}/${totalCount} chapters saved`,
      contextMessage: getSiteIntegrationDisplayName(task.siteIntegrationId),
      priority: 1,
      requireInteraction: false,
    });
  }

  notifyTaskFailed({ task, notificationsEnabled, errorMessage }: TaskFailureNotificationInput): void {
    if (!notificationsEnabled) {
      return;
    }

    const notificationId = `task_error_${task.id}`;
    const failedCount = task.chapters.filter((chapter) => chapter.status === 'failed' || chapter.status === 'partial_success').length;

    chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: getIconUrl(),
      title: task.status === 'partial_success' ? 'Download partially complete' : 'Download failed',
      message: `${task.seriesTitle}: ${failedCount}/${task.chapters.length} chapters failed`,
      contextMessage: getSiteIntegrationDisplayName(task.siteIntegrationId),
      priority: 2,
      requireInteraction: false,
    });

    if (errorMessage) {
      logger.warn('[NotificationManager] Task failure details', {
        taskId: task.id,
        errorMessage,
      });
    }
  }

}

let notificationManager: NotificationManager | null = null;

export function getNotificationManager(): NotificationManager {
  if (!notificationManager) {
    notificationManager = new NotificationManager();
  }

  return notificationManager;
}

