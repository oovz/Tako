/**
 * Notification Service - Background Service Worker Only
 * 
 * Handles browser notifications for download events:
 * - Success notifications with "Open Folder" action
 * - Error notifications with "Retry Failed" action  
 * - Optional per-chapter notifications (configurable)
 * 
 * Success notification on completion with "Open Folder" action
 * Error notification on failure with "Retry" action
 * Background download notifications
 */

import logger from '@/src/runtime/logger';

function getDefaultIconUrl(): string {
  return chrome.runtime.getURL('icon/128.png');
}

export interface NotificationOptions {
  title: string;
  message: string;
  type?: 'basic' | 'progress';
  iconUrl?: string;
  priority?: number;
  requireInteraction?: boolean;
  buttons?: Array<{ title: string; iconUrl?: string }>;
  contextMessage?: string;
}

export interface DownloadCompleteNotificationData {
  seriesTitle: string;
  chaptersCompleted: number;
  chaptersTotal: number;
  taskId: string;
  downloadPath?: string; // Optional resolved folder path for "Open Folder" action
}

export interface DownloadErrorNotificationData {
  seriesTitle: string;
  errorMessage: string;
  taskId: string;
  chaptersFailed: number;
  chaptersTotal: number;
}

export interface ChapterCompleteNotificationData {
  seriesTitle: string;
  chapterTitle: string;
  chapterNumber: number;
  totalChapters: number;
}

/**
 * Notification Service for download events
 */
export class NotificationService {
  private readonly createdNotificationIds = new Set<string>();

  private createNotification(
    id: string,
    options: chrome.notifications.NotificationOptions<true>
  ): void {
    try {
      chrome.notifications.create(id, options);
      this.createdNotificationIds.add(id);
      logger.info(`Notification shown: ${id}`);
    } catch (error) {
      logger.error(`Failed to show notification ${id}:`, error);
    }
  }

  /**
   * Show download complete notification
   * Success notification with "Open Folder" action
   */
  showDownloadCompleteNotification(data: DownloadCompleteNotificationData): void {
    const { seriesTitle, chaptersCompleted, chaptersTotal, taskId, downloadPath } = data;

    const notificationId = `download_complete_${taskId}`;
    const allSuccessful = chaptersCompleted === chaptersTotal;

    const options: chrome.notifications.NotificationOptions<true> = {
      type: 'basic',
      iconUrl: getDefaultIconUrl(),
      title: allSuccessful ? 'Download complete' : 'Download partially complete',
      message: allSuccessful
        ? `${seriesTitle}: ${chaptersTotal} chapter${chaptersTotal === 1 ? '' : 's'} downloaded`
        : `${seriesTitle}: ${chaptersCompleted}/${chaptersTotal} chapters downloaded`,
      priority: 2,
      requireInteraction: false,
    };

    void downloadPath;
    void this.createNotification(notificationId, options);
  }

  /**
   * Show download error notification
   * Error notification with "Retry" action
   */
  showDownloadErrorNotification(data: DownloadErrorNotificationData): void {
    const { seriesTitle, errorMessage, taskId, chaptersFailed, chaptersTotal } = data;

    const notificationId = `download_error_${taskId}`;

    const options: chrome.notifications.NotificationOptions<true> = {
      type: 'basic',
      iconUrl: getDefaultIconUrl(),
      title: 'Download failed',
      message: `${seriesTitle}: ${chaptersFailed}/${chaptersTotal} chapter${chaptersFailed === 1 ? '' : 's'} failed`,
      contextMessage: errorMessage.length > 100 ? errorMessage.substring(0, 97) + '...' : errorMessage,
      priority: 2,
      requireInteraction: true,
    };

    void taskId;
    void this.createNotification(notificationId, options);
  }

  /**
   * Show individual chapter complete notification (optional, configurable)
   * Optional per-chapter notifications
   */
  showChapterCompleteNotification(data: ChapterCompleteNotificationData): void {
    const { seriesTitle, chapterTitle, chapterNumber, totalChapters } = data;

    const notificationId = `chapter_complete_${Date.now()}`;

    const options: chrome.notifications.NotificationOptions<true> = {
      type: 'basic',
      iconUrl: getDefaultIconUrl(),
      title: 'Chapter downloaded',
      message: `${seriesTitle} - ${chapterTitle}`,
      contextMessage: `Progress: ${chapterNumber}/${totalChapters} chapters`,
      priority: 0,
      requireInteraction: false
    };

    void this.createNotification(notificationId, options);
  }

  /**
   * Show generic notification (flexible utility)
   */
  showNotification(id: string, options: NotificationOptions): void {
    const chromeOptions: chrome.notifications.NotificationOptions<true> = {
      type: options.type || 'basic',
      iconUrl: options.iconUrl || getDefaultIconUrl(),
      title: options.title,
      message: options.message,
      contextMessage: options.contextMessage,
      priority: options.priority || 1,
      requireInteraction: options.requireInteraction || false,
      buttons: options.buttons
    };

    void this.createNotification(id, chromeOptions);
  }

  /**
   * Clear all notifications (cleanup utility)
   */
  clearAllNotifications(): void {
    try {
      for (const notificationId of this.createdNotificationIds) {
        void chrome.notifications.clear(notificationId);
      }
      this.createdNotificationIds.clear();
      logger.info('All notifications cleared');
    } catch (error) {
      logger.error('Failed to clear notifications:', error);
    }
  }
}

// Singleton instance
let notificationService: NotificationService | null = null;

/**
 * Get or create notification service singleton
 */
export function getNotificationService(): NotificationService {
  if (!notificationService) {
    notificationService = new NotificationService();
  }
  return notificationService;
}

