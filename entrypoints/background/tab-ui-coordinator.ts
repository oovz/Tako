import logger from "@/src/runtime/logger"
import { matchUrl } from "@/src/site-integrations/url-matcher"
import { isInternalUrl } from "@/src/shared/tab-url-helpers"

const ICON_PATHS = {
  active: {
    16: "icon/16.png",
    32: "icon/32.png",
    48: "icon/48.png",
    128: "icon/128.png",
  },
  inactive: {
    16: "icon/inactive-16.png",
    32: "icon/inactive-32.png",
    48: "icon/inactive-48.png",
    128: "icon/inactive-128.png",
  },
} as const

export { isInternalUrl }

async function setActionIcon(
  tabId: number,
  variant: "active" | "inactive"
): Promise<void> {
  const paths = variant === "active" ? ICON_PATHS.active : ICON_PATHS.inactive
  try {
    await chrome.action.setIcon({ tabId, path: paths })
  } catch {
    if (variant === "inactive") {
      try {
        await chrome.action.setIcon({ tabId, path: ICON_PATHS.active })
      } catch (error) {
        logger.debug("failed to set icon", error)
      }
    }
  }
}

export function createTabUiCoordinator() {
  return {
    async updateActionForTab(
      tabId: number,
      url?: string | null
    ): Promise<void> {
      try {
        const supported = url ? !!matchUrl(url) : false

        if (supported) {
          await chrome.action.enable(tabId)
          await chrome.action.setTitle({ tabId, title: "TMD: Supported site" })
          await setActionIcon(tabId, "active")
          return
        }

        await chrome.action.enable(tabId)
        await chrome.action.setTitle({ tabId, title: "TMD: Unsupported site" })
        await setActionIcon(tabId, "inactive")
      } catch (error) {
        logger.debug("updateActionForTab noop/error", error)
      }
    },

    async updateSidePanelForTab(tabId: number): Promise<void> {
      try {
        await chrome.sidePanel.setOptions({
          tabId,
          path: "sidepanel.html",
          enabled: true,
        })
      } catch (error) {
        logger.debug("Failed to set side panel options (non-fatal):", error)
      }
    },
  }
}
