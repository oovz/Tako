import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/src/runtime/logger', () => ({
  default: {
    debug: vi.fn(),
  },
}))

vi.mock('@/src/site-integrations/url-matcher', () => ({
  matchUrl: vi.fn((url: string) => (
    url.includes('/title/')
      ? { integrationId: 'mangadex', role: 'series' }
      : null
  )),
}))

vi.mock('@/entrypoints/background/content-script-ensure', () => ({
  shouldSkipContentScriptEnsure: vi.fn(() => false),
}))

import { createTabUiCoordinator } from '@/entrypoints/background/tab-ui-coordinator'

describe('createTabUiCoordinator', () => {
  const actionEnable = vi.fn(async () => undefined)
  const actionSetTitle = vi.fn(async () => undefined)
  const actionSetIcon = vi.fn(async () => undefined)
  const actionSetBadgeText = vi.fn(async () => undefined)
  const actionSetBadgeBackgroundColor = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('chrome', {
      action: {
        enable: actionEnable,
        setTitle: actionSetTitle,
        setIcon: actionSetIcon,
        setBadgeText: actionSetBadgeText,
        setBadgeBackgroundColor: actionSetBadgeBackgroundColor,
      },
      scripting: {
        executeScript: vi.fn(async () => undefined),
      },
      sidePanel: {
        setOptions: vi.fn(async () => undefined),
      },
    })
  })

  it('does not repurpose the action badge as a supported-site indicator', async () => {
    const coordinator = createTabUiCoordinator()

    await coordinator.updateActionForTab(7, 'https://mangadex.org/title/series-1')

    expect(actionEnable).toHaveBeenCalledWith(7)
    expect(actionSetTitle).toHaveBeenCalledWith({ tabId: 7, title: 'TMD: Supported site' })
    expect(actionSetIcon).toHaveBeenCalledWith({
      tabId: 7,
      path: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    })
    expect(actionSetBadgeText).not.toHaveBeenCalled()
    expect(actionSetBadgeBackgroundColor).not.toHaveBeenCalled()
  })

  it('does not clear the global queue badge on unsupported tabs', async () => {
    const coordinator = createTabUiCoordinator()

    await coordinator.updateActionForTab(8, 'https://example.com/not-supported')

    expect(actionEnable).toHaveBeenCalledWith(8)
    expect(actionSetTitle).toHaveBeenCalledWith({ tabId: 8, title: 'TMD: Unsupported site' })
    expect(actionSetIcon).toHaveBeenCalledWith({
      tabId: 8,
      path: {
        16: 'icon/inactive-16.png',
        32: 'icon/inactive-32.png',
        48: 'icon/inactive-48.png',
        128: 'icon/inactive-128.png',
      },
    })
    expect(actionSetBadgeText).not.toHaveBeenCalled()
    expect(actionSetBadgeBackgroundColor).not.toHaveBeenCalled()
  })
})
