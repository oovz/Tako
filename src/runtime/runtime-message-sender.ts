import type { RuntimeMessagePrincipal } from "@/src/runtime/runtime-message-contracts"

const OFFSCREEN_PATH = "/offscreen.html"
const OPTIONS_PATH = "/options.html"
const SIDEPANEL_PATH = "/sidepanel.html"
const BACKGROUND_PATHS = new Set(["/background.js", "/background"])

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
  const hasDocumentIdentity =
    typeof sender.documentId === "string" && sender.documentId.length > 0
  if (url?.pathname === SIDEPANEL_PATH && hasDocumentIdentity) {
    return "sidepanel"
  }
  if (url?.pathname === OPTIONS_PATH && hasDocumentIdentity) return "options"
  if (url?.pathname === OFFSCREEN_PATH && sender.tab === undefined) {
    return "offscreen"
  }
  if (
    sender.tab === undefined &&
    sender.documentId === undefined &&
    (sender.url === undefined ||
      (url !== null && BACKGROUND_PATHS.has(url.pathname)))
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
