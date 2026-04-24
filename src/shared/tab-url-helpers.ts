/**
 * Shared helpers for classifying Chrome tab URLs.
 *
 * Ref: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#matchAndGlob
 */

export function isInternalUrl(url: string | undefined | null): boolean {
  if (!url) {
    return true
  }

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

export function isExtensionUrl(url: string | undefined | null): boolean {
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
