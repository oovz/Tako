/** Side Panel messages identify their active source tab in the payload. */
export function resolveSourceTabId(
  sender: chrome.runtime.MessageSender,
  payloadTabId?: number
): number | undefined {
  if (
    typeof payloadTabId === "number" &&
    Number.isInteger(payloadTabId) &&
    payloadTabId >= 0
  ) {
    return payloadTabId
  }
  return typeof sender.tab?.id === "number" ? sender.tab.id : undefined
}
