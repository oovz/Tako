import type { GetTabIdResponse } from '@/src/types/runtime-command-messages'

/**
 * Sender Resolution Utilities
 *
 * Pure functions for resolving tab IDs and validating sender context
 * from chrome.runtime.MessageSender objects.
 *
 * Chrome MV3 sender context rules:
 * - Content scripts: sender.tab is populated with the hosting tab
 * - Extension pages (side panel, options, popup): sender.tab is UNDEFINED
 * - Offscreen documents: sender.tab is UNDEFINED
 *
 * Any message handler that needs a tab ID MUST account for extension-page
 * senders by accepting a fallback (e.g. payload.sourceTabId).
 */

export type SenderOrigin = 'content-script' | 'extension-page' | 'offscreen' | 'unknown';

/**
 * Classify the origin of a message sender.
 *
 * @param sender - The MessageSender from chrome.runtime.onMessage
 * @param extensionId - The extension's own ID (chrome.runtime.id)
 */
export function classifySenderOrigin(
  sender: chrome.runtime.MessageSender,
  extensionId?: string,
): SenderOrigin {
  if (sender.tab && typeof sender.tab.id === 'number') {
    return 'content-script';
  }

  const url = sender.url ?? '';
  const extPrefix = extensionId
    ? `chrome-extension://${extensionId}/`
    : 'chrome-extension://';

  if (url.startsWith(extPrefix)) {
    if (url.includes('offscreen')) {
      return 'offscreen';
    }
    return 'extension-page';
  }

  return 'unknown';
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
  payloadTabId?: number,
): number | undefined {
  const senderTabId = sender.tab?.id;
  if (typeof senderTabId === 'number') {
    return senderTabId;
  }

  if (typeof payloadTabId === 'number' && Number.isInteger(payloadTabId) && payloadTabId >= 0) {
    return payloadTabId;
  }

  return undefined;
}

export function resolveGetTabIdResponse(
  sender: chrome.runtime.MessageSender,
): GetTabIdResponse {
  const senderTabId = sender.tab?.id

  if (typeof senderTabId === 'number') {
    return { success: true, tabId: senderTabId }
  }

  return {
    success: false,
    error: 'GET_TAB_ID requires a sender with sender.tab.id',
  }
}

/**
 * Check whether a sender URL originates from the extension's Options page.
 */
export function isSenderFromOptionsPage(
  sender: chrome.runtime.MessageSender,
  optionsUrlPrefix: string,
): boolean {
  const senderUrl = sender.url ?? '';
  return senderUrl.startsWith(optionsUrlPrefix);
}
