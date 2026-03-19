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

function isExtensionUrl(url: string | undefined): boolean {
  return !!url && url.startsWith('chrome-extension://')
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

function getMostRecentlyAccessedNonInternalTab(tabs: chrome.tabs.Tab[]): chrome.tabs.Tab | null {
  const candidates = tabs.filter((tab) => !isInternalUrl(tab.url))
  if (!candidates.length) return null

  return candidates.reduce((latest, tab) => {
    const latestAccessed = latest.lastAccessed ?? 0
    const tabAccessed = tab.lastAccessed ?? 0
    return tabAccessed > latestAccessed ? tab : latest
  })
}

export async function queryActiveTabInLastFocusedNormalWindow(): Promise<chrome.tabs.Tab | null> {
  try {
    const [active] = await chrome.tabs.query({ currentWindow: true, active: true })
    if (active && !isExtensionUrl(active.url)) return active

    const [lastFocusedActive] = await chrome.tabs.query({ lastFocusedWindow: true, active: true })
    if (lastFocusedActive && !isExtensionUrl(lastFocusedActive.url)) return lastFocusedActive

    const tabs = await chrome.tabs.query({ currentWindow: true })
    const recentNonInternal = getMostRecentlyAccessedNonInternalTab(tabs)
    if (recentNonInternal) return recentNonInternal

    const lastFocusedTabs = await chrome.tabs.query({ lastFocusedWindow: true })
    const lastFocusedNonInternal = getMostRecentlyAccessedNonInternalTab(lastFocusedTabs)
    if (lastFocusedNonInternal) return lastFocusedNonInternal

    const allTabs = await chrome.tabs.query({})
    const globalNonInternal = getMostRecentlyAccessedNonInternalTab(allTabs)
    if (globalNonInternal) return globalNonInternal

    return active || lastFocusedActive || null
  } catch {
    return null
  }
}
