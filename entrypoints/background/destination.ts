import { loadDownloadRootHandle, clearDownloadRootHandle } from '@/src/storage/fs-access';
import { settingsService } from '@/src/storage/settings-service';
import type { ExtensionSettings } from '@/src/storage/settings-types';
import { addPersistentError } from './errors';
import logger from '@/src/runtime/logger';
import { LOCAL_STORAGE_KEYS } from '@/src/runtime/storage-keys';

type EffectiveDestination =
    | { kind: 'custom'; handleId: string; handle: FileSystemDirectoryHandle }
    | { kind: 'downloads' };

export class DestinationService {
    /**
     * Resolves the effective download destination for the next task.
     * When custom-directory mode is enabled and the persisted handle is still available,
     * returns the custom handle. Otherwise it falls back to browser downloads and
     * persists the fallback state for the UI.
     */
    async getEffectiveDestination(): Promise<EffectiveDestination> {
        const settings = await settingsService.getSettings();

        if (!settings.downloads.customDirectoryEnabled || !settings.downloads.customDirectoryHandleId) {
            return { kind: 'downloads' };
        }

        const handleId = settings.downloads.customDirectoryHandleId;

        try {
            // `loadDownloadRootHandle` resolves the persisted root handle if it is still available.
            const handle = await loadDownloadRootHandle();
            if (!handle) {
                await this.clearCustomDirectoryAndFallback(
                    'Custom Folder Missing',
                    'The selected download folder handle is no longer available. Downloads will be saved to your browser\'s default location.'
                );
                return { kind: 'downloads' };
            }

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
        const fullMessage = `${errorTitle}: ${errorMessage}`;

        // Only perform updates if we are currently in custom mode to avoid redundant writes
        if (!settings.downloads.customDirectoryEnabled) {
            return;
        }

        logger.warn('[DestinationService] Clearing custom directory, falling back to browser downloads');

        await this.disableCustomDirectory(settings);

        await addPersistentError({
            code: 'FSA_HANDLE_INVALID',
            message: fullMessage,
            severity: 'warning'
        });

        await this.persistFallbackBanner(fullMessage);
    }

    private async disableCustomDirectory(settings: ExtensionSettings): Promise<void> {
        const { downloads } = settings;

        await settingsService.updateSettings({
            downloads: {
                ...downloads,
                downloadMode: 'browser',
                customDirectoryEnabled: false,
                customDirectoryHandleId: null,
            },
        });

        try {
            await clearDownloadRootHandle();
        } catch (e) {
            logger.error('[DestinationService] Failed to remove handle from IDB', e);
        }
    }

    private async persistFallbackBanner(message: string): Promise<void> {
        await chrome.storage.local.set({
            [LOCAL_STORAGE_KEYS.fsaError]: {
                active: true,
                message,
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


