import { loadDownloadRootHandle, clearDownloadRootHandle } from '@/src/storage/fs-access';
import { settingsService } from '@/src/storage/settings-service';
import { errorService } from './errors';
import logger from '@/src/runtime/logger';
import { LOCAL_STORAGE_KEYS } from '@/src/runtime/storage-keys';

export class DestinationService {
    /**
     * Resolves the effective download directory handle ID.
     * If the user has enabled custom directory and a valid handle exists, returns it.
     * If the handle is invalid or missing, it falls back to browser downloads,
     * updates settings, and logs a persistent error.
     */
    async getEffectiveDestination(): Promise<{ kind: 'custom'; handleId: string; handle: FileSystemDirectoryHandle } | { kind: 'downloads' }> {
        const settings = await settingsService.getSettings();

        if (!settings.downloads.customDirectoryEnabled || !settings.downloads.customDirectoryHandleId) {
            return { kind: 'downloads' };
        }

        const handleId = settings.downloads.customDirectoryHandleId;

        try {
            // Verify handle existence and permission (basic check)
            // We use loadDownloadRootHandle which uses the fixed 'download-root' key
            const handle = await loadDownloadRootHandle();
            if (!handle) {
                await this.clearCustomDirectoryAndFallback(
                    'Custom Folder Missing',
                    'The selected download folder handle is no longer available. Downloads will be saved to your browser\'s default location.'
                );
                return { kind: 'downloads' };
            }

            // Permission check is often async and might require user gesture if not persisted,
            // but for background/offscreen use, we rely on the handle being valid.
            // If we can't verify it here without gesture, we assume it's good and let the offscreen script fail if needed.
            // However, we can check if we have read/write access if the API allows queryPermission.
            // For MVP, we'll assume if we have the handle, we try to use it.

            return { kind: 'custom', handleId, handle };
        } catch (error) {
            logger.warn('[DestinationService] Custom directory handle invalid or missing, falling back to downloads', error);

            await this.clearCustomDirectoryAndFallback(
                'Custom Folder Error',
                'The selected download folder is no longer accessible. Downloads will be saved to your browser\'s default location.'
            );
            return { kind: 'downloads' };
        }
    }

    /**
     * Clears custom directory configuration and falls back to browser downloads.
     * Consolidates all fallback logic into a single method.
     * 
     * @param errorTitle - Short title for the persistent error notification
     * @param errorMessage - Detailed message explaining why fallback occurred
     */
    async clearCustomDirectoryAndFallback(errorTitle: string, errorMessage: string): Promise<void> {
        const settings = await settingsService.getSettings();

        // Only perform updates if we are currently in custom mode to avoid redundant writes
        if (!settings.downloads.customDirectoryEnabled) {
            return;
        }

        logger.warn('[DestinationService] Clearing custom directory, falling back to browser downloads');

        // 1. Disable custom directory in settings
        await settingsService.updateSettings({
            downloads: {
                ...settings.downloads,
                customDirectoryEnabled: false,
                customDirectoryHandleId: null,
            },
        });

        // 2. Clean up handle from IndexedDB
        try {
            await clearDownloadRootHandle();
        } catch (e) {
            logger.error('[DestinationService] Failed to remove handle from IDB', e);
        }

        // 3. Emit persistent error to notify user
        await errorService.emit({
            code: 'FSA_HANDLE_INVALID',
            message: `${errorTitle}: ${errorMessage}`,
            severity: 'warning'
        });

        // 4. Persist banner state for Side Panel/Options warning surfaces
        await chrome.storage.local.set({
            [LOCAL_STORAGE_KEYS.fsaError]: {
                active: true,
                message: `${errorTitle}: ${errorMessage}`,
            },
        });
    }

    /**
     * Called when a write failure occurs during download (e.g. from Offscreen).
     */
    async reportWriteFailure(error: unknown): Promise<void> {
        const msg = error instanceof Error ? error.message : String(error);
        await this.clearCustomDirectoryAndFallback(
            'Download Location Changed',
            `Write failed: ${msg}. Falling back to browser downloads.`
        );
    }
}

export const destinationService = new DestinationService();


