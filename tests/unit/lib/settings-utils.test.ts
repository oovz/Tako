import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveEffectiveRetries } from '@/src/shared/settings-utils';

// Mock siteOverridesService
vi.mock('@/src/storage/site-overrides-service', () => ({
    siteOverridesService: {
        getAll: vi.fn(),
    },
}));

import { siteOverridesService } from '@/src/storage/site-overrides-service';

describe('Settings Utils', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('resolveEffectiveRetries', () => {
        it('returns global defaults when no integrationId is provided', async () => {
            const result = await resolveEffectiveRetries(undefined);
            expect(result).toEqual({ image: 3, chapter: 3 });
        });

        it('returns provided global settings when no integrationId is provided', async () => {
            const settings: any = { globalRetries: { image: 5, chapter: 5 } };
            const result = await resolveEffectiveRetries(undefined, settings);
            expect(result).toEqual({ image: 5, chapter: 5 });
        });

        it('returns global defaults when a site integration has no overrides', async () => {
            vi.mocked(siteOverridesService.getAll).mockResolvedValue({});
            const result = await resolveEffectiveRetries('test-integration');
            expect(result).toEqual({ image: 3, chapter: 3 });
        });

        it('returns overrides when present', async () => {
            vi.mocked(siteOverridesService.getAll).mockResolvedValue({
                'test-integration': {
                    retries: { image: 10, chapter: 10 },
                } as any,
            });
            const result = await resolveEffectiveRetries('test-integration');
            expect(result).toEqual({ image: 10, chapter: 10 });
        });

        it('merges overrides with defaults (partial override)', async () => {
            vi.mocked(siteOverridesService.getAll).mockResolvedValue({
                'test-integration': {
                    retries: { image: 10 }, // Only image overridden
                } as any,
            });
            const result = await resolveEffectiveRetries('test-integration');
            expect(result).toEqual({ image: 10, chapter: 3 });
        });


    });
});

