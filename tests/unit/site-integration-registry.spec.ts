/**
 * Unit tests for site-integration-registry.ts
 * 
 * Tests the idempotent registration behavior to prevent duplicate logs
 * when the same site integration is registered multiple times (e.g., during HMR).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SiteIntegration } from '@/src/types/site-integrations'

// Mock the logger
vi.mock('@/src/runtime/logger', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}))

/**
 * Helper to create a valid mock SiteIntegration with all required properties
 */
function createMockSiteIntegration(id: string): SiteIntegration {
    return {
        id,
        content: {
            name: 'Test',
            series: {
                getSeriesId: () => 'id',
                extractSeriesMetadata: () => ({ title: 'Test' }),
                extractChapterList: () => [],
            },
        },
        background: {
            name: 'Test Background',
            chapter: {
                parseImageUrlsFromHtml: async () => [],
                processImageUrls: async () => [],
                downloadImage: async () => ({ data: new ArrayBuffer(0), filename: 'test.jpg', mimeType: 'image/jpeg' }),
            },
        },
    }
}

describe('SiteIntegrationRegistry idempotent registration', () => {
    let siteIntegrationRegistry: typeof import('@/src/runtime/site-integration-registry').siteIntegrationRegistry
    let loggerMock: typeof import('@/src/runtime/logger').default

    beforeEach(async () => {
        // Reset module registry to get fresh singleton state
        vi.resetModules()

        // Re-setup mocks
        vi.doMock('@/src/runtime/logger', () => ({
            default: {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                debug: vi.fn(),
            },
        }))

        const registryModule = await import('@/src/runtime/site-integration-registry')
        const loggerModule = await import('@/src/runtime/logger')

        siteIntegrationRegistry = registryModule.siteIntegrationRegistry
        loggerMock = loggerModule.default
        siteIntegrationRegistry.clear() // Clear any existing registrations
    })

    it('logs registration on first call', () => {
        siteIntegrationRegistry.register({
            id: 'test-integration',
            name: 'Test Integration',
            version: '1.0.0',
            author: 'Test',
        })

        expect(loggerMock.info).toHaveBeenCalledWith(
            '📝 Registering site integration: Test Integration v1.0.0'
        )
        expect(loggerMock.info).toHaveBeenCalledWith(
            '✅ Site integration test-integration registered successfully'
        )
    })

    it('skips duplicate metadata-only registration without logging info', () => {
        // First registration (metadata-only)
        siteIntegrationRegistry.register({
            id: 'test-integration',
            name: 'Test Integration',
            version: '1.0.0',
            author: 'Test',
        })

        vi.clearAllMocks()

        // Second registration (same metadata-only)
        siteIntegrationRegistry.register({
            id: 'test-integration',
            name: 'Test Integration',
            version: '1.0.0',
            author: 'Test',
        })

        // Should log debug skip message, not info registration
        expect(loggerMock.debug).toHaveBeenCalledWith(
            '⏭️ Site integration metadata test-integration already registered, skipping'
        )
        expect(loggerMock.info).not.toHaveBeenCalledWith(
            expect.stringContaining('Registering site integration')
        )
    })

    it('skips duplicate full site integration registration with same version', () => {
        const mockIntegration = createMockSiteIntegration('test-integration')

        // First registration
        siteIntegrationRegistry.register({
            id: 'test-integration',
            name: 'Test Integration',
            version: '1.0.0',
            author: 'Test',
            integration: mockIntegration,
        })

        vi.clearAllMocks()

        // Second registration (same version)
        siteIntegrationRegistry.register({
            id: 'test-integration',
            name: 'Test Integration',
            version: '1.0.0',
            author: 'Test',
            integration: mockIntegration,
        })

        // Should log debug skip message, not info registration
        expect(loggerMock.debug).toHaveBeenCalledWith(
            '⏭️ Site integration test-integration already registered, skipping'
        )
        expect(loggerMock.info).not.toHaveBeenCalledWith(
            expect.stringContaining('Registering site integration')
        )
    })

    it('upgrades metadata-only registration to full site integration', () => {
        // First registration (metadata-only)
        siteIntegrationRegistry.register({
            id: 'test-integration',
            name: 'Test Integration',
            version: '1.0.0',
            author: 'Test',
        })

        vi.clearAllMocks()

        const mockIntegration = createMockSiteIntegration('test-integration')

        // Second registration (with full site integration)
        siteIntegrationRegistry.register({
            id: 'test-integration',
            name: 'Test Integration',
            version: '1.0.0',
            author: 'Test',
            integration: mockIntegration,
        })

        // Should log info because it's upgrading from metadata-only to full
        expect(loggerMock.info).toHaveBeenCalledWith(
            '📝 Registering site integration: Test Integration v1.0.0'
        )

        // Verify the integration was updated
        const info = siteIntegrationRegistry.findById('test-integration')
        expect(info?.integration).toBeDefined()
    })

    it('re-registers when version changes', () => {
        const mockIntegration = createMockSiteIntegration('test-integration')

        // First registration
        siteIntegrationRegistry.register({
            id: 'test-integration',
            name: 'Test Integration',
            version: '1.0.0',
            author: 'Test',
            integration: mockIntegration,
        })

        vi.clearAllMocks()

        // Second registration with new version
        siteIntegrationRegistry.register({
            id: 'test-integration',
            name: 'Test Integration',
            version: '1.1.0', // Version changed
            author: 'Test',
            integration: mockIntegration,
        })

        // Should log registration because version changed
        expect(loggerMock.info).toHaveBeenCalledWith(
            '📝 Registering site integration: Test Integration v1.1.0'
        )
    })
})

