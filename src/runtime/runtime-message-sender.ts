import type { RuntimeMessagePrincipal } from "@/src/runtime/runtime-message-contracts"

const DOCUMENT_PRINCIPALS = new Map<string, RuntimeMessagePrincipal>([
  ["/sidepanel.html", "sidepanel"],
  ["/options.html", "options"],
])

function classifyWorkerPrincipal(
  sender: chrome.runtime.MessageSender,
  url: URL | null
): RuntimeMessagePrincipal {
  if (sender.tab !== undefined) return "unknown"
  if (url?.pathname === "/offscreen.html") return "offscreen"
  if (sender.url === undefined || url?.pathname === "/background.js")
    return "background"
  return "unknown"
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
  const document = url && DOCUMENT_PRINCIPALS.get(url.pathname)
  if (document) return document
  const worker = classifyWorkerPrincipal(sender, url)
  if (worker !== "unknown") return worker

  return classifyContentPrincipal(sender)
}

function classifyContentPrincipal(
  sender: chrome.runtime.MessageSender
): RuntimeMessagePrincipal {
  return typeof sender.tab?.id === "number" &&
    !sender.url?.startsWith("chrome-extension://")
    ? "content"
    : "unknown"
}
