import {
  isExtensionUrl,
  isInternalUrl,
  resolveTabUrlForSupportCheck,
} from "@/src/shared/tab-url-helpers"

export { isExtensionUrl, isInternalUrl, resolveTabUrlForSupportCheck }

export function resolveTrackedTabId(
  activeTab: Pick<chrome.tabs.Tab, "id" | "url" | "pendingUrl"> | undefined
): number | undefined {
  return typeof activeTab?.id === "number" ? activeTab.id : undefined
}
