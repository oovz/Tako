import { resolveSourceTabId } from "@/entrypoints/background/sender-resolution"
import type { BackgroundRuntimeHandlerDependencies } from "@/entrypoints/background/background-runtime-handler-dependencies"
import type { RuntimeMessageHandlerMap } from "@/src/runtime/runtime-message-dispatcher"

export function createBackgroundTabContextMessageHandlers(
  deps: BackgroundRuntimeHandlerDependencies
): Pick<RuntimeMessageHandlerMap<"background">, "REQUEST_TAB_CONTEXT_REFRESH"> {
  return {
    REQUEST_TAB_CONTEXT_REFRESH: async (message, sender) => {
      const tabId = resolveSourceTabId(sender, message.payload.tabId)
      if (typeof tabId !== "number") {
        return {
          success: false,
          error: "REQUEST_TAB_CONTEXT_REFRESH requires a target tab",
        }
      }
      const tab = await chrome.tabs.get(tabId)
      if (!tab.active) {
        return {
          success: false,
          error: "REQUEST_TAB_CONTEXT_REFRESH target tab is not active",
        }
      }
      if (
        typeof message.payload.windowId === "number" &&
        tab.windowId !== message.payload.windowId
      ) {
        return {
          success: false,
          error: "REQUEST_TAB_CONTEXT_REFRESH target window did not match tab",
        }
      }

      await deps.tabContextResolver.resolveTabContext(tabId, {
        windowId: tab.windowId,
        allowCached: true,
      })
      return { success: true }
    },
  }
}
