/**
 * Shared helpers for classifying browser tab URLs.
 *
 * Ref: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#matchAndGlob
 */

const INTERNAL_URL_PREFIXES = [
  "chrome-extension://",
  "moz-extension://",
  "chrome://",
  "edge://",
  "about:",
  "devtools://",
  "blob:",
  "data:",
  "view-source:",
  "file://",
  "mailto:",
  "tel:",
  "javascript:",
]

export function isInternalUrl(url: string | undefined | null): boolean {
  if (!url) return true
  return INTERNAL_URL_PREFIXES.some((prefix) => url.startsWith(prefix))
}

export function isExtensionUrl(url: string | undefined | null): boolean {
  return (
    !!url &&
    (url.startsWith("chrome-extension://") ||
      url.startsWith("moz-extension://"))
  )
}

export function resolveTabUrlForSupportCheck(
  tab: Pick<chrome.tabs.Tab, "url" | "pendingUrl"> | undefined
): string {
  const currentUrl = tab?.url
  const pendingUrl = tab?.pendingUrl

  if (
    isInternalUrl(currentUrl) &&
    typeof pendingUrl === "string" &&
    pendingUrl.length > 0
  ) {
    return pendingUrl
  }

  return currentUrl ?? pendingUrl ?? ""
}
