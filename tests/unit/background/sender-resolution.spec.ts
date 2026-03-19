/**
 * Tests for sender resolution utilities.
 *
 * These tests guard against the class of bug where message handlers
 * assume sender.tab is always populated. Chrome MV3 sender context:
 * - Content scripts: sender.tab is populated
 * - Extension pages (side panel, options, popup): sender.tab is UNDEFINED
 * - Offscreen documents: sender.tab is UNDEFINED
 *
 * Ref: https://developer.chrome.com/docs/extensions/reference/api/runtime#type-MessageSender
 */
import { describe, it, expect } from 'vitest'

import {
  resolveSourceTabId,
  resolveGetTabIdResponse,
  classifySenderOrigin,
  isSenderFromOptionsPage,
  type SenderOrigin,
} from '@/entrypoints/background/sender-resolution'

// ---------------------------------------------------------------------------
// Sender fixtures — reusable shapes for each Chrome MV3 sender context
// ---------------------------------------------------------------------------

const EXTENSION_ID = 'abcdefghijklmnop'

function contentScriptSender(tabId: number): chrome.runtime.MessageSender {
  return {
    tab: { id: tabId, index: 0, windowId: 1, active: true, pinned: false, highlighted: false, incognito: false, selected: false, discarded: false, autoDiscardable: true, groupId: -1 },
    frameId: 0,
    url: 'https://mangadex.org/title/abc',
    id: EXTENSION_ID,
  }
}

function sidePanelSender(): chrome.runtime.MessageSender {
  return {
    url: `chrome-extension://${EXTENSION_ID}/sidepanel.html`,
    id: EXTENSION_ID,
  }
}

function popupSender(): chrome.runtime.MessageSender {
  return {
    url: `chrome-extension://${EXTENSION_ID}/popup.html`,
    id: EXTENSION_ID,
  }
}

function optionsPageSender(): chrome.runtime.MessageSender {
  return {
    url: `chrome-extension://${EXTENSION_ID}/options.html?tab=downloads`,
    id: EXTENSION_ID,
  }
}

function offscreenSender(): chrome.runtime.MessageSender {
  return {
    url: `chrome-extension://${EXTENSION_ID}/offscreen.html`,
    id: EXTENSION_ID,
    documentId: 'offscreen-doc-1',
  }
}

function unknownSender(): chrome.runtime.MessageSender {
  return {}
}

// ---------------------------------------------------------------------------
// classifySenderOrigin
// ---------------------------------------------------------------------------

describe('classifySenderOrigin', () => {
  it('identifies content script sender', () => {
    expect(classifySenderOrigin(contentScriptSender(42), EXTENSION_ID))
      .toBe<SenderOrigin>('content-script')
  })

  it('identifies side panel as extension-page', () => {
    expect(classifySenderOrigin(sidePanelSender(), EXTENSION_ID))
      .toBe<SenderOrigin>('extension-page')
  })

  it('identifies options page as extension-page', () => {
    expect(classifySenderOrigin(optionsPageSender(), EXTENSION_ID))
      .toBe<SenderOrigin>('extension-page')
  })

  it('identifies offscreen document', () => {
    expect(classifySenderOrigin(offscreenSender(), EXTENSION_ID))
      .toBe<SenderOrigin>('offscreen')
  })

  it('returns unknown for empty sender', () => {
    expect(classifySenderOrigin(unknownSender(), EXTENSION_ID))
      .toBe<SenderOrigin>('unknown')
  })
})

// ---------------------------------------------------------------------------
// resolveSourceTabId — THE critical function that was missing coverage
// ---------------------------------------------------------------------------

describe('resolveSourceTabId', () => {
  it('returns sender.tab.id for content script sender', () => {
    expect(resolveSourceTabId(contentScriptSender(42))).toBe(42)
  })

  it('returns sender.tab.id even when payloadTabId is also provided (sender is authoritative)', () => {
    expect(resolveSourceTabId(contentScriptSender(42), 99)).toBe(42)
  })

  it('falls back to payloadTabId for side panel sender (sender.tab undefined)', () => {
    expect(resolveSourceTabId(sidePanelSender(), 99)).toBe(99)
  })

  it('falls back to payloadTabId for options page sender', () => {
    expect(resolveSourceTabId(optionsPageSender(), 55)).toBe(55)
  })

  it('falls back to payloadTabId for offscreen sender', () => {
    expect(resolveSourceTabId(offscreenSender(), 77)).toBe(77)
  })

  it('accepts payloadTabId zero for extension-page fallback senders', () => {
    expect(resolveSourceTabId(sidePanelSender(), 0)).toBe(0)
  })

  it('returns undefined when side panel sender provides no payloadTabId', () => {
    expect(resolveSourceTabId(sidePanelSender())).toBeUndefined()
  })

  it('returns undefined when no sender.tab and payloadTabId is negative', () => {
    expect(resolveSourceTabId(sidePanelSender(), -1)).toBeUndefined()
  })

  it('returns undefined for completely empty sender with no fallback', () => {
    expect(resolveSourceTabId(unknownSender())).toBeUndefined()
  })
})

describe('resolveGetTabIdResponse', () => {
  it('returns success when sender.tab.id is present', () => {
    expect(resolveGetTabIdResponse(contentScriptSender(42))).toEqual({
      success: true,
      tabId: 42,
    })
  })

  it('treats numeric tab ids as valid even when they are zero', () => {
    expect(resolveGetTabIdResponse(contentScriptSender(0))).toEqual({
      success: true,
      tabId: 0,
    })
  })

  it('rejects extension-page senders that do not originate from a tab', () => {
    expect(resolveGetTabIdResponse(sidePanelSender())).toEqual({
      success: false,
      error: 'GET_TAB_ID requires a sender with sender.tab.id',
    })
  })
})

// ---------------------------------------------------------------------------
// isSenderFromOptionsPage
// ---------------------------------------------------------------------------

describe('isSenderFromOptionsPage', () => {
  const optionsPrefix = `chrome-extension://${EXTENSION_ID}/options.html`

  it('returns true for options page sender', () => {
    expect(isSenderFromOptionsPage(optionsPageSender(), optionsPrefix)).toBe(true)
  })

  it('returns false for side panel sender', () => {
    expect(isSenderFromOptionsPage(sidePanelSender(), optionsPrefix)).toBe(false)
  })

  it('returns false for popup sender', () => {
    expect(isSenderFromOptionsPage(popupSender(), optionsPrefix)).toBe(false)
  })

  it('returns false for content script sender', () => {
    expect(isSenderFromOptionsPage(contentScriptSender(1), optionsPrefix)).toBe(false)
  })

  it('returns false for offscreen sender', () => {
    expect(isSenderFromOptionsPage(offscreenSender(), optionsPrefix)).toBe(false)
  })

  it('returns false for empty sender', () => {
    expect(isSenderFromOptionsPage(unknownSender(), optionsPrefix)).toBe(false)
  })
})

describe('CLEAR_ALL_HISTORY sender authorization contract', () => {
  const optionsPrefix = `chrome-extension://${EXTENSION_ID}/options.html`

  it('authorizes options page sender only', () => {
    expect(isSenderFromOptionsPage(optionsPageSender(), optionsPrefix)).toBe(true)
  })

  it('rejects content script sender', () => {
    expect(isSenderFromOptionsPage(contentScriptSender(100), optionsPrefix)).toBe(false)
  })

  it('rejects side panel sender', () => {
    expect(isSenderFromOptionsPage(sidePanelSender(), optionsPrefix)).toBe(false)
  })

  it('rejects offscreen sender', () => {
    expect(isSenderFromOptionsPage(offscreenSender(), optionsPrefix)).toBe(false)
  })
})

