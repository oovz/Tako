/**
 * Sender Resolution Utilities
 *
 * Pure functions for resolving tab IDs and validating sender context
 * from chrome.runtime.MessageSender objects.
 *
 * Chrome MV3 sender context rules:
 * - Content scripts: sender.tab is populated with the hosting tab,
 *   sender.url is the web page URL (NOT chrome-extension://)
 * - Extension pages (side panel, options, popup): sender.url is a
 *   chrome-extension:// URL. sender.tab MAY be populated for side panels
 *   (they are associated with a tab/window), so URL-based classification
 *   takes priority over sender.tab in classifySenderOrigin.
 * - Offscreen documents: sender.tab is UNDEFINED, sender.url is the
 *   offscreen.html chrome-extension:// URL
 *
 * Any message handler that needs a tab ID MUST account for extension-page
 * senders by accepting a fallback (e.g. payload.sourceTabId).
 */

export type SenderOrigin =
  "content-script" | "extension-page" | "offscreen" | "unknown"

const OFFSCREEN_DOCUMENT_PATHNAME = "/offscreen.html"

function parseExtensionSenderUrl(
  senderUrl: string,
  extensionId?: string
): URL | null {
  if (!senderUrl) {
    return null
  }

  try {
    const url = new URL(senderUrl)
    if (url.protocol !== "chrome-extension:") {
      return null
    }

    if (extensionId && url.hostname !== extensionId) {
      return null
    }

    return url
  } catch {
    return null
  }
}

/**
 * Classify the origin of a message sender.
 *
 * Classification priority:
 * 1. Extension URL (chrome-extension://) — takes priority over sender.tab
 *    because Chrome MV3 side panels may have sender.tab populated even though
 *    they are extension pages, not content scripts.
 * 2. sender.tab — content scripts hosted in a web page tab.
 * 3. unknown — no recognizable origin.
 *
 * @param sender - The MessageSender from chrome.runtime.onMessage
 * @param extensionId - The extension's own ID (chrome.runtime.id)
 */
export function classifySenderOrigin(
  sender: chrome.runtime.MessageSender,
  extensionId?: string
): SenderOrigin {
  if (extensionId && sender.id && sender.id !== extensionId) {
    return "unknown"
  }

  const senderUrl = sender.url ?? ""
  const url = parseExtensionSenderUrl(senderUrl, extensionId)
  if (url) {
    if (url.pathname === OFFSCREEN_DOCUMENT_PATHNAME) {
      return "offscreen"
    }
    return "extension-page"
  }

  // A chrome-extension:// URL that did not pass the own-extension check must
  // never fall through to the content-script branch merely because it also
  // carries a tab (for example, a side panel from another extension).
  if (senderUrl.startsWith("chrome-extension://")) {
    return "unknown"
  }

  if (sender.tab && typeof sender.tab.id === "number") {
    return "content-script"
  }

  return "unknown"
}

/**
 * Resolve a source tab ID from a message sender and optional payload fallback.
 *
 * Resolution order:
 * 1. sender.tab.id (content script context — always authoritative)
 * 2. payloadTabId (extension-page fallback — provided by side panel / options)
 *
 * @returns The resolved tab ID, or undefined if neither source provides one.
 */
export function resolveSourceTabId(
  sender: chrome.runtime.MessageSender,
  payloadTabId?: number
): number | undefined {
  const senderTabId = sender.tab?.id
  if (typeof senderTabId === "number") {
    return senderTabId
  }

  if (
    typeof payloadTabId === "number" &&
    Number.isInteger(payloadTabId) &&
    payloadTabId >= 0
  ) {
    return payloadTabId
  }

  return undefined
}

/**
 * Check whether a sender URL originates from the extension's Options page.
 */
export function isSenderFromOptionsPage(
  sender: chrome.runtime.MessageSender,
  optionsUrlPrefix: string
): boolean {
  try {
    const senderUrl = new URL(sender.url ?? "")
    const optionsUrl = new URL(optionsUrlPrefix)
    return (
      senderUrl.origin === optionsUrl.origin &&
      senderUrl.pathname === optionsUrl.pathname
    )
  } catch {
    return false
  }
}
