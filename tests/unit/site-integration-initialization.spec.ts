/**
 * Unit tests for site-integration-initialization.ts
 * 
 * Tests the singleton pattern to prevent duplicate site integration registration.
 * Ref: Prevents duplicate logs issue when multiple navigation events trigger initialization.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const storageOnChangedAddListener = vi.fn()
const setUserSiteIntegrationEnablementMock = vi.fn()

// Mock the site-integration registry before importing
vi.mock('@/src/runtime/site-integration-registry', () => ({
    registerSiteIntegration: vi.fn(),
    siteIntegrationRegistry: {
        findById: vi.fn(() => null),
    },
}))

vi.mock('@/src/site-integrations/registry', () => ({
    setUserSiteIntegrationEnablement: setUserSiteIntegrationEnablementMock,
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
        vi.stubGlobal('chrome', {
            storage: {
                local: {
                    get: vi.fn(async () => ({})),
                },
                onChanged: {
                    addListener: storageOnChangedAddListener,
                },
            },
        })

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
        vi.doMock('@/src/site-integrations/registry', () => ({
            setUserSiteIntegrationEnablement: setUserSiteIntegrationEnablementMock,
        }))

        // Get the mock reference
        const registryModule = await import('@/src/runtime/site-integration-registry')
        registerSiteIntegrationMock = registryModule.registerSiteIntegration as ReturnType<typeof vi.fn>
    })

    afterEach(() => {
        vi.clearAllMocks()
        vi.unstubAllGlobals()
    })

    it('registers site integrations only once on first call', async () => {
        const { initializeSiteIntegrationMetadataOnly } = await import('@/src/runtime/site-integration-initialization')

        await initializeSiteIntegrationMetadataOnly()

        // Should have registered 5 site integrations (mangadex, pixiv-comic, shonenjumpplus, manhuagui, comicnettai)
        expect(registerSiteIntegrationMock).toHaveBeenCalledTimes(5)
        expect(registerSiteIntegrationMock).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'mangadex' })
        )
        expect(registerSiteIntegrationMock).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'pixiv-comic' })
        )
        expect(registerSiteIntegrationMock).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'shonenjumpplus' })
        )
        expect(registerSiteIntegrationMock).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'manhuagui' })
        )
        expect(registerSiteIntegrationMock).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'comicnettai' })
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

        // Should only register 5 site integrations total (not 15)
        expect(registerSiteIntegrationMock).toHaveBeenCalledTimes(5)
    })

    it('normalizes malformed enablement storage changes through the shared parser', async () => {
        const { initializeSiteIntegrationMetadataOnly } = await import('@/src/runtime/site-integration-initialization')

        await initializeSiteIntegrationMetadataOnly()

        const onChangedListener = storageOnChangedAddListener.mock.calls[0]?.[0] as (
            changes: Record<string, chrome.storage.StorageChange>,
            areaName: chrome.storage.AreaName,
        ) => void

        onChangedListener(
            {
                siteIntegrationEnablement: {
                    oldValue: null,
                    newValue: {
                        mangadex: false,
                        broken: 'bad',
                    },
                },
            } as Record<string, chrome.storage.StorageChange>,
            'local',
        )

        expect(setUserSiteIntegrationEnablementMock).toHaveBeenLastCalledWith({ mangadex: false })

        onChangedListener(
            {
                siteIntegrationEnablement: {
                    oldValue: null,
                    newValue: 'bad',
                },
            } as Record<string, chrome.storage.StorageChange>,
            'local',
        )

        expect(setUserSiteIntegrationEnablementMock).toHaveBeenLastCalledWith({})
    })
})

describe('site-integration-initialization full integration lookup', () => {
    afterEach(() => {
        vi.clearAllMocks()
        vi.resetModules()
        vi.unstubAllGlobals()
    })

    it('upgrades metadata-only registrations when a background integration is requested', async () => {
        vi.resetModules()

        const registry = new Map<string, unknown>()
        const registerSiteIntegration = vi.fn((info: { id: string }) => {
            registry.set(info.id, info)
        })

        vi.doMock('@/src/runtime/site-integration-registry', () => ({
            registerSiteIntegration,
            siteIntegrationRegistry: {
                findById: vi.fn((id: string) => registry.get(id) ?? null),
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

        vi.stubGlobal('chrome', {
            storage: {
                local: {
                    get: vi.fn(async () => ({})),
                },
                onChanged: {
                    addListener: vi.fn(),
                },
            },
        })

        const { getBackgroundSiteAdapterById } = await import('@/src/runtime/background-site-integration-initialization')

        const integration = await getBackgroundSiteAdapterById('pixiv-comic')

        expect(integration?.background.prepareDispatchContext).toEqual(expect.any(Function))
        expect('chapter' in (integration?.background ?? {})).toBe(false)
        const backgroundRegistration = registerSiteIntegration.mock.calls
            .map(([info]) => info)
            .find((info: { id?: string; integration?: unknown }) => info.id === 'pixiv-comic' && info.integration)
        expect(backgroundRegistration).toEqual(
            expect.objectContaining({
                id: 'pixiv-comic',
                integration: expect.objectContaining({
                    id: 'pixiv-comic',
                    background: expect.not.objectContaining({
                        chapter: expect.anything(),
                    }),
                }),
            }),
        )
        expect((backgroundRegistration as { integration?: { content?: unknown } }).integration?.content).toBeUndefined()
    })

    it('registers offscreen chapter runtimes separately from service-worker runtimes', async () => {
        vi.resetModules()

        const registry = new Map<string, unknown>()
        const registerSiteIntegration = vi.fn((info: { id: string; integration?: unknown }) => {
            const existing = registry.get(info.id) as { integration?: Record<string, unknown> } | undefined
            registry.set(info.id, existing && info.integration
                ? {
                    ...existing,
                    ...info,
                    integration: {
                        ...(existing.integration ?? {}),
                        ...(info.integration as Record<string, unknown>),
                    },
                }
                : info)
        })

        vi.doMock('@/src/runtime/site-integration-registry', () => ({
            registerSiteIntegration,
            siteIntegrationRegistry: {
                findById: vi.fn((id: string) => registry.get(id) ?? null),
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

        // Offscreen documents only expose chrome.runtime; provide the
        // sendMessage-based enablement loader path (no chrome.storage).
        vi.stubGlobal('chrome', {
            runtime: {
                sendMessage: vi.fn(async () => ({ success: true, enablement: {} })),
            },
        })

        const {
            initializeOffscreenSiteIntegrations,
        } = await import('@/src/runtime/site-integration-offscreen-initialization')

        await initializeOffscreenSiteIntegrations()

        const pixivRegistration = registry.get('pixiv-comic') as {
            integration?: {
                background?: unknown
                offscreen?: { chapter?: unknown }
            }
        }
        expect(pixivRegistration.integration?.offscreen?.chapter).toEqual(expect.any(Object))
        expect(pixivRegistration.integration?.background).toBeUndefined()
    })

    it('all enabled manifests stay metadata-only', async () => {
        const { SITE_INTEGRATION_MANIFESTS } = await import('@/src/site-integrations/manifest')

        for (const manifest of SITE_INTEGRATION_MANIFESTS) {
            if (manifest.enabled === false) {
                continue
            }

            expect('runtimePath' in manifest).toBe(false)
            expect('contentImportPath' in manifest).toBe(false)
            expect('contentExportName' in manifest).toBe(false)
            expect('backgroundImportPath' in manifest).toBe(false)
            expect('backgroundExportName' in manifest).toBe(false)
            expect('offscreenImportPath' in manifest).toBe(false)
            expect('offscreenExportName' in manifest).toBe(false)
        }
    })
})
