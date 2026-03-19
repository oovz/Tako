import { siteOverridesService } from '@/src/storage/site-overrides-service';
import type { ExtensionSettings } from '@/src/storage/settings-types';

/**
 * Resolve effective retry counts: site override > global settings
 */
export async function resolveEffectiveRetries(integrationId: string | undefined, settings?: ExtensionSettings): Promise<{ image: number; chapter: number }> {
    const fallback = settings?.globalRetries ?? { image: 3, chapter: 3 };
    try {
        if (!integrationId) return fallback;
        const overrides = await siteOverridesService.getAll();
        const o = overrides[integrationId];
        if (o?.retries && (o.retries.image != null || o.retries.chapter != null)) {
            return {
                image: typeof o.retries.image === 'number' ? o.retries.image : fallback.image,
                chapter: typeof o.retries.chapter === 'number' ? o.retries.chapter : fallback.chapter,
            };
        }
    } catch {
        // ignore and fallback
    }
    return fallback;
}
