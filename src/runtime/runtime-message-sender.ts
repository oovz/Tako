import type { RuntimeMessagePrincipal } from "@/src/runtime/runtime-message-contracts"

const OFFSCREEN_PATHS: Record<string, true> = {
  "/offscreen.html": true,
  "/offscreen/index.html": true,
  "/offscreen": true,
}
const OPTIONS_PATHS: Record<string, true> = {
  "/options.html": true,
  "/options/index.html": true,
  "/options": true,
}
const SIDEPANEL_PATHS: Record<string, true> = {
  "/sidepanel.html": true,
  "/sidepanel/index.html": true,
  "/sidepanel": true,
}
const BACKGROUND_PATHS: Record<string, true> = {
  "/background.js": true,
  "/background": true,
  "/_generated_background_page.html": true,
}

function parseOwnExtensionUrl(
  value: string | undefined,
  extensionId: string
): URL | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === "chrome-extension:" && url.hostname === extensionId
      ? url
      : null
  } catch {
    return null
  }
}

/** Resolve the exact packaged extension principal represented by MessageSender. */
export function classifyRuntimeMessagePrincipal(
  sender: chrome.runtime.MessageSender,
  extensionId: string
): RuntimeMessagePrincipal {
  if (!extensionId || sender.id !== extensionId) return "unknown"

  const url = parseOwnExtensionUrl(sender.url, extensionId)
  if (url !== null && SIDEPANEL_PATHS[url.pathname]) {
    return "sidepanel"
  }
  if (url !== null && OPTIONS_PATHS[url.pathname]) {
    return "options"
  }
  if (
    url !== null &&
    OFFSCREEN_PATHS[url.pathname] &&
    sender.tab === undefined
  ) {
    return "offscreen"
  }
  if (
    sender.tab === undefined &&
    (sender.url === undefined ||
      (url !== null && BACKGROUND_PATHS[url.pathname]))
  ) {
    return "background"
  }

  if (
    typeof sender.tab?.id === "number" &&
    !sender.url?.startsWith("chrome-extension://")
  ) {
    return "content"
  }
  return "unknown"
}
