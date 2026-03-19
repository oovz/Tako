/**
 * Unit tests for site-integration-initialization.ts
 * 
 * Tests the singleton pattern to prevent duplicate site integration registration.
 * Ref: Prevents duplicate logs issue when multiple navigation events trigger initialization.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the site-integration registry before importing
vi.mock('@/src/runtime/site-integration-registry', () => ({
    registerSiteIntegration: vi.fn(),
    siteIntegrationRegistry: {
        findById: vi.fn(() => null),
    },
}))

// Mock the logger
vi.mock('@/src/runtime/logger', () => ({
    default: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}))

describe('site-integration-initialization singleton pattern', () => {
    let registerSiteIntegrationMock: ReturnType<typeof vi.fn>

    beforeEach(async () => {
        // Reset module registry to get fresh singleton state
        vi.resetModules()

        // Re-setup mocks after module reset
        vi.doMock('@/src/runtime/site-integration-registry', () => ({
            registerSiteIntegration: vi.fn(),
            siteIntegrationRegistry: {
                findById: vi.fn(() => null),
            },
        }))
        vi.doMock('@/src/runtime/logger', () => ({
            default: {
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            },
        }))

        // Get the mock reference
        const registryModule = await import('@/src/runtime/site-integration-registry')
        registerSiteIntegrationMock = registryModule.registerSiteIntegration as ReturnType<typeof vi.fn>
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it('registers site integrations only once on first call', async () => {
        const { initializeSiteIntegrationMetadataOnly } = await import('@/src/runtime/site-integration-initialization')

        await initializeSiteIntegrationMetadataOnly()

        // Should have registered 3 site integrations (mangadex, pixiv-comic, shonenjumpplus)
        expect(registerSiteIntegrationMock).toHaveBeenCalledTimes(3)
        expect(registerSiteIntegrationMock).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'mangadex' })
        )
        expect(registerSiteIntegrationMock).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'pixiv-comic' })
        )
        expect(registerSiteIntegrationMock).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'shonenjumpplus' })
        )
    })

    it('does not re-register site integrations on subsequent calls', async () => {
        const { initializeSiteIntegrationMetadataOnly } = await import('@/src/runtime/site-integration-initialization')

        // First call
        await initializeSiteIntegrationMetadataOnly()
        const firstCallCount = registerSiteIntegrationMock.mock.calls.length

        // Second call
        await initializeSiteIntegrationMetadataOnly()

        // Third call
        await initializeSiteIntegrationMetadataOnly()

        // Should still be the same count as after first call
        expect(registerSiteIntegrationMock.mock.calls.length).toBe(firstCallCount)
    })

    it('handles concurrent calls correctly', async () => {
        const { initializeSiteIntegrationMetadataOnly } = await import('@/src/runtime/site-integration-initialization')

        // Make multiple concurrent calls
        const results = await Promise.all([
            initializeSiteIntegrationMetadataOnly(),
            initializeSiteIntegrationMetadataOnly(),
            initializeSiteIntegrationMetadataOnly(),
        ])

        // All should resolve successfully
        expect(results).toHaveLength(3)

        // Should only register 3 site integrations total (not 9)
        expect(registerSiteIntegrationMock).toHaveBeenCalledTimes(3)
    })
})

