/**
 * @file spa-navigation-cleanup.spec.ts
 * @description Tests for SPA navigation state cleanup in the background script
 *
 * Verifies that when navigating within an SPA (like MangaDex) from a supported
 * series page to an unsupported page (like the homepage), the background script
 * properly clears the stale tab state.
 *
 * This is critical for SPAs because:
 * 1. Content scripts don't re-inject on SPA navigation
 * 2. The pagehide event doesn't fire
 * 3. Therefore CLEAR_TAB_STATE is never sent by the content script
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveSpaNavigationAction } from '@/entrypoints/background/spa-navigation'

// Mock matchUrl for testing
vi.mock('@/src/site-integrations/url-matcher', () => ({
    matchUrl: vi.fn((url: string) => {
        // Simulates MangaDex URL patterns
        // Series pages are supported: /title/abc123/manga-name
        // Homepage and other pages are not: /
        if (url.includes('/title/')) return { integrationId: 'mangadex', role: 'series' }
        return null
    })
}))

describe('SPA Navigation State Cleanup Logic', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    describe('URL Support Detection', () => {
        it('identifies MangaDex series page as supported', async () => {
            const { matchUrl } = await import('@/src/site-integrations/url-matcher')

            const result = matchUrl('https://mangadex.org/title/abc123/test-manga')
            expect(result).toBeTruthy()
            expect(result?.integrationId).toBe('mangadex')
        })

        it('identifies MangaDex homepage as unsupported', async () => {
            const { matchUrl } = await import('@/src/site-integrations/url-matcher')

            const result = matchUrl('https://mangadex.org/')
            expect(result).toBeNull()
        })

        it('identifies MangaDex titles list as unsupported', async () => {
            const { matchUrl } = await import('@/src/site-integrations/url-matcher')

            const result = matchUrl('https://mangadex.org/titles')
            expect(result).toBeNull()
        })

        it('identifies MangaDex search as unsupported', async () => {
            const { matchUrl } = await import('@/src/site-integrations/url-matcher')

            const result = matchUrl('https://mangadex.org/search')
            expect(result).toBeNull()
        })
    })

    describe('Navigation State Cleanup Decision Logic', () => {
        it('should trigger cleanup when navigating from supported to unsupported URL', async () => {
            const { matchUrl } = await import('@/src/site-integrations/url-matcher')

            // Simulate: user was on supported page, now navigating to unsupported
            const previousUrl = 'https://mangadex.org/title/abc123/test-manga'
            const newUrl = 'https://mangadex.org/'

            const wasSupported = !!matchUrl(previousUrl)
            const isNowSupported = !!matchUrl(newUrl)

            expect(wasSupported).toBe(true)
            expect(isNowSupported).toBe(false)

            // The cleanup should trigger when:
            // - New URL is not supported (!isNowSupported)
            // - Tab state exists (would be checked in actual implementation)
            const shouldCleanup = !isNowSupported
            expect(shouldCleanup).toBe(true)
            expect(resolveSpaNavigationAction({
                isUrlSupported: isNowSupported,
                hasExistingTabState: true,
            })).toBe('clear-tab-state')
        })

        it('treats supported-to-supported SPA navigation as a no-op', async () => {
            const { matchUrl } = await import('@/src/site-integrations/url-matcher')

            // Simulate: user navigates from one manga to another
            const previousUrl = 'https://mangadex.org/title/abc123/test-manga'
            const newUrl = 'https://mangadex.org/title/def456/another-manga'

            const wasSupported = !!matchUrl(previousUrl)
            const isNowSupported = !!matchUrl(newUrl)

            expect(wasSupported).toBe(true)
            expect(isNowSupported).toBe(true)

            expect(resolveSpaNavigationAction({
                isUrlSupported: isNowSupported,
                hasExistingTabState: true,
            })).toBe('noop')
        })

        it('treats unsupported-to-supported SPA navigation as a no-op until refresh', () => {
            expect(resolveSpaNavigationAction({
                isUrlSupported: true,
                hasExistingTabState: false,
            })).toBe('noop')
        })

        it('should NOT trigger cleanup when navigating from unsupported to unsupported', async () => {
            const { matchUrl } = await import('@/src/site-integrations/url-matcher')

            // Simulate: user navigates from homepage to search
            const previousUrl = 'https://mangadex.org/'
            const newUrl = 'https://mangadex.org/search?q=test'

            const wasSupported = !!matchUrl(previousUrl)
            const isNowSupported = !!matchUrl(newUrl)

            expect(wasSupported).toBe(false)
            expect(isNowSupported).toBe(false)

            expect(resolveSpaNavigationAction({
                isUrlSupported: isNowSupported,
                hasExistingTabState: false,
            })).toBe('noop')
        })
    })
})

