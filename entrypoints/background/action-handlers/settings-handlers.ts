/**
 * Settings and Persistence Action Handlers
 * 
 * Handlers for settings updates and download history persistence.
 */

import logger from '@/src/runtime/logger';
import { chapterPersistenceService } from '@/src/storage/chapter-persistence-service';
import { CentralizedStateManager } from '@/src/runtime/centralized-state';
import type {
  UpdateSettingsPayload,
  ClearDownloadHistoryPayload
} from '@/src/types/state-action-settings-payloads';

/**
 * Update extension settings in global state
 * 
 * Settings Management
 * 
 * Merges partial settings update into current settings in global state.
 * Settings are persisted separately via settingsService.
 * 
 * @param stateManager - State manager instance
 * @param payload - Partial settings object to merge
 * @returns Success confirmation
 */
export async function handleUpdateSettings(
  stateManager: CentralizedStateManager,
  payload: UpdateSettingsPayload
): Promise<{ success: boolean }> {
  const { settings: partialSettings } = payload;
  const currentState = await stateManager.getGlobalState();
  const mergedSettings = { ...currentState.settings, ...partialSettings };
  await stateManager.updateGlobalState({ settings: mergedSettings });
  return { success: true };
}

/**
 * Clear download history (all series or specific series)
 * 
 * Download History
 * 
 * Clears download history from chrome.storage.local. If seriesId provided,
 * clears only that series; otherwise clears all history.
 * 
 * @param _stateManager - State manager instance
 * @param payload - Optional seriesId to clear specific series
 * @returns Success confirmation or error
 */
export async function handleClearDownloadHistory(
  _stateManager: CentralizedStateManager,
  payload?: ClearDownloadHistoryPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    const { seriesId } = payload || {};
    
    // Clear history (all or specific series)
    if (seriesId) {
      await chapterPersistenceService.clearSeriesDownloadHistory(seriesId);
      logger.info(`Cleared download history for series: ${seriesId}`);
    } else {
      await chapterPersistenceService.clearAllDownloadHistory();
      logger.info('Cleared all download history');
    }

    return { success: true };
  } catch (error) {
    logger.error('Error clearing download history:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMessage };
  }
}

