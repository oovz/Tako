/**
 * Check if a URL is an internal/non-content URL that we don't support.
 * This includes browser chrome pages, extension pages, and non-HTTP protocols.
 * Ref: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#matchAndGlob
 */
export function isInternalUrl(url: string | undefined): boolean {
  if (!url) return true
  return (
    url.startsWith('chrome-extension://') ||
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('devtools://') ||
    url.startsWith('blob:') ||
    url.startsWith('data:') ||
    url.startsWith('view-source:') ||
    url.startsWith('file://') ||
    url.startsWith('mailto:') ||
    url.startsWith('tel:') ||
    url.startsWith('javascript:')
  )
}

export function isExtensionUrl(url: string | undefined): boolean {
  return typeof url === 'string' && url.startsWith('chrome-extension://')
}

export function resolveTabUrlForSupportCheck(
  tab: Pick<chrome.tabs.Tab, 'url' | 'pendingUrl'> | undefined,
): string {
  const currentUrl = tab?.url
  const pendingUrl = tab?.pendingUrl

  if (isInternalUrl(currentUrl) && typeof pendingUrl === 'string' && pendingUrl.length > 0) {
    return pendingUrl
  }

  return currentUrl ?? pendingUrl ?? ''
}

export function resolveTrackedTabId(
  previousTrackedTabId: number | undefined,
  activeTab: Pick<chrome.tabs.Tab, 'id' | 'url' | 'pendingUrl'> | undefined,
): number | undefined {
  const activeUrl = resolveTabUrlForSupportCheck(activeTab)

  if (isExtensionUrl(activeUrl)) {
    return previousTrackedTabId
  }

  return typeof activeTab?.id === 'number' ? activeTab.id : undefined
}
