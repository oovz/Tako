/**
 * Guards offscreen site-integration enablement loading. The offscreen document
 * only exposes chrome.runtime. Reading chrome.storage.local there throws a
 * TypeError and silently falls back to defaults, so user-disabled integrations
 * can be ignored in the offscreen context.
 *
 * The fix routes the offscreen enablement read through chrome.runtime messaging
 * (GET_SITE_INTEGRATION_ENABLEMENT) to the background service worker, which
 * DOES have chrome.storage access. These tests assert:
 *   1. The offscreen init never touches chrome.storage (it is absent).
 *   2. It sends GET_SITE_INTEGRATION_ENABLEMENT via chrome.runtime.sendMessage.
 *   3. User-disabled integrations from the background response are honored.
 *   4. A failed/non-success background response falls back to defaults
 *      (empty overrides) without throwing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const setUserSiteIntegrationEnablementMock = vi.fn()

vi.mock('@/src/site-integrations/registry', () => ({
  setUserSiteIntegrationEnablement: setUserSiteIntegrationEnablementMock,
  SITE_INTEGRATION_MANIFESTS: [],
}))

vi.mock('@/src/runtime/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe('offscreen site integration enablement loader', () => {
  const runtimeSendMessage = vi.fn()
  // Storage spies are sentinels only. The offscreen loader must not call them.
  const storageLocalGet = vi.fn()
  const storageLocalSet = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('chrome', {
      // Only chrome.runtime is available in the offscreen document.
      runtime: {
        sendMessage: runtimeSendMessage,
      },
      // Sentinel to prove the loader never reaches storage: if it did, these
      // would be invoked and the tests below would fail.
      storage: {
        local: {
          get: storageLocalGet,
          set: storageLocalSet,
        },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('routes enablement read through chrome.runtime.sendMessage and honors user-disabled integrations', async () => {
    runtimeSendMessage.mockResolvedValueOnce({
      success: true,
      enablement: { mangadex: false, 'pixiv-comic': true },
    })

    const { initializeOffscreenSiteIntegrations } = await import(
      '@/src/runtime/site-integration-offscreen-initialization'
    )

    await initializeOffscreenSiteIntegrations()

    // Must have asked the background for the enablement map.
    expect(runtimeSendMessage).toHaveBeenCalledTimes(1)
    expect(runtimeSendMessage).toHaveBeenCalledWith({ type: 'GET_SITE_INTEGRATION_ENABLEMENT' })

    // Must NOT have touched chrome.storage.local at all.
    expect(storageLocalGet).not.toHaveBeenCalled()
    expect(storageLocalSet).not.toHaveBeenCalled()

    // User-disabled integrations must be propagated (not silently defaulted).
    expect(setUserSiteIntegrationEnablementMock).toHaveBeenCalledWith({
      mangadex: false,
      'pixiv-comic': true,
    })
  })

  it('falls back to empty overrides (defaults) when background returns success: false', async () => {
    runtimeSendMessage.mockResolvedValueOnce({ success: false, error: 'storage read failed' })

    const { initializeOffscreenSiteIntegrations } = await import(
      '@/src/runtime/site-integration-offscreen-initialization'
    )

    await initializeOffscreenSiteIntegrations()

    expect(runtimeSendMessage).toHaveBeenCalledWith({ type: 'GET_SITE_INTEGRATION_ENABLEMENT' })
    expect(setUserSiteIntegrationEnablementMock).toHaveBeenCalledWith({})
    expect(storageLocalGet).not.toHaveBeenCalled()
  })

  it('falls back to empty overrides (defaults) when sendMessage rejects', async () => {
    runtimeSendMessage.mockRejectedValueOnce(new Error('extension context invalidated'))

    const { initializeOffscreenSiteIntegrations } = await import(
      '@/src/runtime/site-integration-offscreen-initialization'
    )

    // Must not throw — graceful degradation.
    await expect(initializeOffscreenSiteIntegrations()).resolves.toBeUndefined()

    expect(runtimeSendMessage).toHaveBeenCalledWith({ type: 'GET_SITE_INTEGRATION_ENABLEMENT' })
    expect(setUserSiteIntegrationEnablementMock).toHaveBeenCalledWith({})
    expect(storageLocalGet).not.toHaveBeenCalled()
  })
})
