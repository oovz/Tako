/**
 * Tests for sender resolution utilities.
 *
 * These tests guard against the class of bug where message handlers
 * assume sender.tab is always populated. Chrome MV3 sender context:
 * - Content scripts: sender.tab is populated, sender.url is the web page URL
 * - Extension pages (side panel, options, popup): sender.url is chrome-extension://
 *   Side panels MAY also have sender.tab populated (associated tab/window)
 * - Offscreen documents: sender.tab is UNDEFINED, sender.url is offscreen.html
 *
 * Ref: https://developer.chrome.com/docs/extensions/reference/api/runtime#type-MessageSender
 */
import { describe, it, expect } from "vitest"

import {
  resolveSourceTabId,
  classifySenderOrigin,
  isSenderFromOptionsPage,
  type SenderOrigin,
} from "@/entrypoints/background/sender-resolution"

// ---------------------------------------------------------------------------
// Sender fixtures — reusable shapes for each Chrome MV3 sender context
// ---------------------------------------------------------------------------

const EXTENSION_ID = "abcdefghijklmnop"

function contentScriptSender(tabId: number): chrome.runtime.MessageSender {
  return {
    tab: {
      id: tabId,
      index: 0,
      windowId: 1,
      active: true,
      pinned: false,
      highlighted: false,
      incognito: false,
      selected: false,
      discarded: false,
      autoDiscardable: true,
      frozen: false,
      groupId: -1,
    },
    frameId: 0,
    url: "https://mangadex.org/title/abc",
    id: EXTENSION_ID,
  }
}

function sidePanelSender(): chrome.runtime.MessageSender {
  return {
    url: `chrome-extension://${EXTENSION_ID}/sidepanel.html`,
    id: EXTENSION_ID,
  }
}

/**
 * Real-world Chrome MV3 side panel sender with sender.tab populated.
 * Chrome associates side panels with a tab/window, so sender.tab.id IS
 * set even though the side panel is an extension page (not a content script).
 * This must be classified as 'extension-page', NOT 'content-script'.
 */
function sidePanelSenderWithTab(
  tabId: number = 123
): chrome.runtime.MessageSender {
  return {
    tab: {
      id: tabId,
      index: 0,
      windowId: 1,
      active: true,
      pinned: false,
      highlighted: false,
      incognito: false,
      selected: false,
      discarded: false,
      autoDiscardable: true,
      frozen: false,
      groupId: -1,
    },
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
    documentId: "offscreen-doc-1",
  }
}

function unknownSender(): chrome.runtime.MessageSender {
  return {}
}

function extensionPageWithOffscreenQuerySender(): chrome.runtime.MessageSender {
  return {
    url: `chrome-extension://${EXTENSION_ID}/sidepanel.html?view=offscreen`,
    id: EXTENSION_ID,
  }
}

function extensionPageWithOffscreenPathPrefixSender(): chrome.runtime.MessageSender {
  return {
    url: `chrome-extension://${EXTENSION_ID}/offscreen-settings.html`,
    id: EXTENSION_ID,
  }
}

// ---------------------------------------------------------------------------
// classifySenderOrigin
// ---------------------------------------------------------------------------

describe("classifySenderOrigin", () => {
  it("identifies content script sender", () => {
    expect(
      classifySenderOrigin(contentScriptSender(42), EXTENSION_ID)
    ).toBe<SenderOrigin>("content-script")
  })

  it("identifies side panel as extension-page", () => {
    expect(
      classifySenderOrigin(sidePanelSender(), EXTENSION_ID)
    ).toBe<SenderOrigin>("extension-page")
  })

  it("identifies side panel with sender.tab as extension-page (not content-script)", () => {
    // Chrome MV3 side panels may have sender.tab populated because they are
    // associated with a tab/window. URL-based classification must take priority
    // so the side panel is not misclassified as a content script.
    expect(
      classifySenderOrigin(sidePanelSenderWithTab(), EXTENSION_ID)
    ).toBe<SenderOrigin>("extension-page")
  })

  it("identifies options page as extension-page", () => {
    expect(
      classifySenderOrigin(optionsPageSender(), EXTENSION_ID)
    ).toBe<SenderOrigin>("extension-page")
  })

  it("identifies offscreen document", () => {
    expect(
      classifySenderOrigin(offscreenSender(), EXTENSION_ID)
    ).toBe<SenderOrigin>("offscreen")
  })

  it("does not classify extension pages with offscreen in query text as offscreen documents", () => {
    expect(
      classifySenderOrigin(
        extensionPageWithOffscreenQuerySender(),
        EXTENSION_ID
      )
    ).toBe<SenderOrigin>("extension-page")
  })

  it("does not classify extension pages with offscreen path prefixes as offscreen documents", () => {
    expect(
      classifySenderOrigin(
        extensionPageWithOffscreenPathPrefixSender(),
        EXTENSION_ID
      )
    ).toBe<SenderOrigin>("extension-page")
  })

  it("returns unknown for empty sender", () => {
    expect(
      classifySenderOrigin(unknownSender(), EXTENSION_ID)
    ).toBe<SenderOrigin>("unknown")
  })

  it("returns unknown for a sender that identifies as another extension", () => {
    expect(
      classifySenderOrigin(
        {
          ...contentScriptSender(42),
          id: "different-extension-id",
        },
        EXTENSION_ID
      )
    ).toBe<SenderOrigin>("unknown")
  })

  it("does not reinterpret another extension page with a tab as a content script", () => {
    expect(
      classifySenderOrigin(
        {
          ...sidePanelSenderWithTab(42),
          id: "different-extension-id",
          url: "chrome-extension://different-extension-id/sidepanel.html",
        },
        EXTENSION_ID
      )
    ).toBe<SenderOrigin>("unknown")
  })
})

// ---------------------------------------------------------------------------
// resolveSourceTabId — THE critical function that was missing coverage
// ---------------------------------------------------------------------------

describe("resolveSourceTabId", () => {
  it("returns sender.tab.id for content script sender", () => {
    expect(resolveSourceTabId(contentScriptSender(42))).toBe(42)
  })

  it("returns sender.tab.id even when payloadTabId is also provided (sender is authoritative)", () => {
    expect(resolveSourceTabId(contentScriptSender(42), 99)).toBe(42)
  })

  it("falls back to payloadTabId for side panel sender (sender.tab undefined)", () => {
    expect(resolveSourceTabId(sidePanelSender(), 99)).toBe(99)
  })

  it("falls back to payloadTabId for options page sender", () => {
    expect(resolveSourceTabId(optionsPageSender(), 55)).toBe(55)
  })

  it("falls back to payloadTabId for offscreen sender", () => {
    expect(resolveSourceTabId(offscreenSender(), 77)).toBe(77)
  })

  it("accepts payloadTabId zero for extension-page fallback senders", () => {
    expect(resolveSourceTabId(sidePanelSender(), 0)).toBe(0)
  })

  it("returns undefined when side panel sender provides no payloadTabId", () => {
    expect(resolveSourceTabId(sidePanelSender())).toBeUndefined()
  })

  it("returns undefined when no sender.tab and payloadTabId is negative", () => {
    expect(resolveSourceTabId(sidePanelSender(), -1)).toBeUndefined()
  })

  it("returns undefined for completely empty sender with no fallback", () => {
    expect(resolveSourceTabId(unknownSender())).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// isSenderFromOptionsPage
// ---------------------------------------------------------------------------

describe("isSenderFromOptionsPage", () => {
  const optionsPrefix = `chrome-extension://${EXTENSION_ID}/options.html`

  it("returns true for options page sender", () => {
    expect(isSenderFromOptionsPage(optionsPageSender(), optionsPrefix)).toBe(
      true
    )
  })

  it("returns false for side panel sender", () => {
    expect(isSenderFromOptionsPage(sidePanelSender(), optionsPrefix)).toBe(
      false
    )
  })

  it("returns false for popup sender", () => {
    expect(isSenderFromOptionsPage(popupSender(), optionsPrefix)).toBe(false)
  })

  it("returns false for content script sender", () => {
    expect(isSenderFromOptionsPage(contentScriptSender(1), optionsPrefix)).toBe(
      false
    )
  })

  it("returns false for offscreen sender", () => {
    expect(isSenderFromOptionsPage(offscreenSender(), optionsPrefix)).toBe(
      false
    )
  })

  it("returns false for empty sender", () => {
    expect(isSenderFromOptionsPage(unknownSender(), optionsPrefix)).toBe(false)
  })

  it("returns false for similarly named extension pages", () => {
    expect(
      isSenderFromOptionsPage(
        {
          url: `chrome-extension://${EXTENSION_ID}/options.html.backup?tab=downloads`,
          id: EXTENSION_ID,
        },
        optionsPrefix
      )
    ).toBe(false)
  })
})

describe("CLEAR_ALL_HISTORY sender authorization contract", () => {
  const optionsPrefix = `chrome-extension://${EXTENSION_ID}/options.html`

  it("authorizes options page sender only", () => {
    expect(isSenderFromOptionsPage(optionsPageSender(), optionsPrefix)).toBe(
      true
    )
  })

  it("rejects content script sender", () => {
    expect(
      isSenderFromOptionsPage(contentScriptSender(100), optionsPrefix)
    ).toBe(false)
  })

  it("rejects side panel sender", () => {
    expect(isSenderFromOptionsPage(sidePanelSender(), optionsPrefix)).toBe(
      false
    )
  })

  it("rejects offscreen sender", () => {
    expect(isSenderFromOptionsPage(offscreenSender(), optionsPrefix)).toBe(
      false
    )
  })
})
