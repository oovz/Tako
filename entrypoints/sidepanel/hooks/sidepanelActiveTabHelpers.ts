import {
  isExtensionUrl,
  isInternalUrl,
  resolveTabUrlForSupportCheck,
} from '@/src/shared/tab-url-helpers'

export { isExtensionUrl, isInternalUrl, resolveTabUrlForSupportCheck }

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
