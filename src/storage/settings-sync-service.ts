/**
 * Settings Synchronization Service
 * 
 * Handles real-time synchronization between storage.local and storage.session
 * to ensure settings changes propagate immediately across all extension components.
 */

import logger from '@/src/runtime/logger';
import { canonicalizeSettingsDocument, settingsService, SETTINGS_STORAGE_KEY } from './settings-service';
import { loadDownloadRootHandle, verifyPermission, clearDownloadRootHandle } from './fs-access';
import type { ExtensionSettings } from './settings-types';
import { SyncSettingsToStateMessage } from '../types/runtime-command-messages';
import { addPersistentError } from '@/entrypoints/background/errors';
import { isRecord } from '@/src/shared/type-guards';

export interface SettingsSyncNotification {
  type: 'SETTINGS_CHANGED';
  settings: ExtensionSettings;
  changedKeys: string[];
}

/**
 * Settings synchronization service that ensures all storage layers stay in sync
 */
export class SettingsSyncService {
  private listeners: Set<(notification: SettingsSyncNotification) => void> = new Set();
  private isInitialized = false;

  /**
   * Initialize the sync service with storage change listeners
   */
  initialize(): void {
    if (this.isInitialized) return;

    try {
      // Listen for changes to the settings key in storage.local
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes[SETTINGS_STORAGE_KEY]) {
          const newSettings = canonicalizeSettingsDocument(changes[SETTINGS_STORAGE_KEY].newValue);
          const oldSettings = canonicalizeSettingsDocument(changes[SETTINGS_STORAGE_KEY].oldValue);

          if (newSettings) {
            this.notifySettingsChange(newSettings, oldSettings ?? undefined);
          }
        }
      });

      this.isInitialized = true;
      logger.info('Settings sync service initialized');
    } catch (error) {
      logger.error('Failed to initialize settings sync service:', error);
    }
  }

  /**
   * Validate download mode configuration
   */
  async validateDownloadMode(downloadMode: string): Promise<{ isValid: boolean; error?: string }> {
    if (downloadMode === 'browser') {
      return { isValid: true };
    }

    if (downloadMode === 'custom') {
      try {
        const handle = await loadDownloadRootHandle();
        if (!handle) {
          return { 
            isValid: false, 
            error: 'Custom download mode requires a folder to be selected. Please choose a folder first.' 
          };
        }

        const hasPermission = await verifyPermission(handle, true);
        if (!hasPermission) {
          return { 
            isValid: false, 
            error: 'Permission denied for the selected folder. Please select a new folder or grant permission.' 
          };
        }

        return { isValid: true };
      } catch (error) {
        return { 
          isValid: false, 
          error: `Failed to validate custom folder: ${error instanceof Error ? error.message : 'Unknown error'}` 
        };
      }
    }

    return { isValid: false, error: 'Invalid download mode' };
  }

  /**
   * Check and handle missing file descriptors for custom download mode
   */
  async validateCustomFolderAccess(): Promise<{ isValid: boolean; shouldFallback: boolean; error?: string }> {
    try {
      const currentSettings = await settingsService.getSettings();
      
      if (currentSettings.downloads.downloadMode === 'custom') {
        const handle = await loadDownloadRootHandle();
        
        if (!handle) {
          logger.warn('Custom folder mode enabled but no folder handle found - falling back to browser mode');
          await this.fallbackToBrowserMode();
          await clearDownloadRootHandle();
          await addPersistentError({
            code: 'custom-folder-missing',
            message: 'Custom folder was cleared. Switched to browser downloads.',
            severity: 'warning'
          });
          return { 
            isValid: false, 
            shouldFallback: true, 
            error: 'Custom folder was cleared. Switched to browser downloads.' 
          };
        }

        const hasPermission = await verifyPermission(handle, true);
        if (!hasPermission) {
          logger.warn('Custom folder mode enabled but no permission - falling back to browser mode');
          await this.fallbackToBrowserMode();
          await clearDownloadRootHandle();
          await addPersistentError({
            code: 'custom-folder-permission-lost',
            message: 'Lost access to custom folder. Switched to browser downloads.',
            severity: 'warning'
          });
          return { 
            isValid: false, 
            shouldFallback: true, 
            error: 'Lost access to custom folder. Switched to browser downloads.' 
          };
        }

        return { isValid: true, shouldFallback: false };
      }

      return { isValid: true, shouldFallback: false };
    } catch (error) {
      logger.error('Error validating custom folder access:', error);
      return { 
        isValid: false, 
        shouldFallback: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Fallback to browser download mode when custom folder is unavailable
   */
  private async fallbackToBrowserMode(): Promise<void> {
    try {
      const currentSettings = await settingsService.getSettings();
      await settingsService.updateSettings({
        downloads: {
          ...currentSettings.downloads,
          downloadMode: 'browser',
          customDirectoryEnabled: false,
          customDirectoryHandleId: null,
        }
      });
      logger.info('Automatically switched to browser download mode due to missing custom folder');
    } catch (error) {
      logger.error('Failed to fallback to browser mode:', error);
    }
  }

  /**
   * Update settings with validation and immediate sync
   */
  async updateSettingsWithSync(updates: Partial<ExtensionSettings>): Promise<{ success: boolean; error?: string; settings?: ExtensionSettings }> {
    try {
      // Validate download mode if it's being changed
      if (updates.downloads?.downloadMode) {
        const validation = await this.validateDownloadMode(updates.downloads.downloadMode);
        if (!validation.isValid) {
          return { success: false, error: validation.error };
        }
      }

      // Update settings using the existing service
      const newSettings = await settingsService.updateSettings(updates);

  // Trigger centralized state update via message to background (authoritative writer)
      await this.triggerCentralizedStateUpdate(newSettings);

      return { success: true, settings: newSettings };
    } catch (error) {
      logger.error('Failed to update settings with sync:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to update settings' 
      };
    }
  }

  /**
   * Trigger centralized state update via action message
   */
  private async triggerCentralizedStateUpdate(settings: ExtensionSettings): Promise<void> {
    try {
      // Send a message to the background script to update centralized state
      await chrome.runtime.sendMessage<SyncSettingsToStateMessage>({
        type: 'SYNC_SETTINGS_TO_STATE',
        payload: { settings }
      });
    } catch (error) {
      // This might fail if background script isn't ready, which is OK
      logger.debug('Could not send settings sync message to background (may not be ready):', error);
    }
  }

  /**
   * Notify all listeners about settings changes AND sync to centralized state
   */
  private notifySettingsChange(newSettings: ExtensionSettings, oldSettings?: ExtensionSettings): void {
    const changedKeys: string[] = [];

    if (oldSettings) {
      this.findChangedKeys('', newSettings, oldSettings, changedKeys);
    } else {
      changedKeys.push('*'); // All keys changed (first time)
    }

    const notification: SettingsSyncNotification = {
      type: 'SETTINGS_CHANGED',
      settings: newSettings,
      changedKeys
    };

    this.listeners.forEach(listener => {
      try {
        listener(notification);
      } catch (error) {
        logger.error('Settings sync listener error:', error);
      }
    });

    // CRITICAL: Sync settings to centralized state (chrome.storage.session)
    // This ensures background/offscreen documents see the updated settings
    void this.triggerCentralizedStateUpdate(newSettings);
  }

  /**
   * Deep compare objects to find changed keys
   */
  private findChangedKeys(
    prefix: string,
    newObj: object,
    oldObj: object | undefined,
    changedKeys: string[]
  ): void {
    const oldEntries = new Map<string, unknown>(Object.entries(oldObj ?? {}));

    for (const [key, newValue] of Object.entries(newObj)) {
      const oldValue = oldEntries.get(key);
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (isRecord(newValue) && isRecord(oldValue)) {
        this.findChangedKeys(fullKey, newValue, oldValue, changedKeys);
      } else if (newValue !== oldValue) {
        changedKeys.push(fullKey);
      }
    }
  }

  /**
   * Add a listener for settings changes
   */
  addListener(listener: (notification: SettingsSyncNotification) => void): void {
    this.listeners.add(listener);
  }

  /**
   * Remove a listener for settings changes
   */
  removeListener(listener: (notification: SettingsSyncNotification) => void): void {
    this.listeners.delete(listener);
  }

  /**
   * Check if custom folder is configured and valid
   */
  async isCustomFolderConfigured(): Promise<boolean> {
    try {
      const handle = await loadDownloadRootHandle();
      if (!handle) return false;
      
      return await verifyPermission(handle, true);
    } catch {
      return false;
    }
  }
}

// Singleton instance
export const settingsSyncService = new SettingsSyncService();

