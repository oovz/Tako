import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"

export async function openOptionsTab({
  page,
  taskId,
}: RuntimeMessageRequest<"OPEN_OPTIONS">["payload"]): Promise<void> {
  const params = new URLSearchParams()
  if (page) params.set("tab", page)
  if (taskId) params.set("task", taskId)
  const query = params.toString()
  const url = chrome.runtime.getURL(
    query ? `options.html?${query}` : "options.html"
  )
  const [existing] = await chrome.tabs.query({
    url: chrome.runtime.getURL("options.html*"),
  })
  if (typeof existing?.id === "number") {
    await chrome.tabs.update(existing.id, { active: true, url })
    if (typeof existing.windowId === "number") {
      await chrome.windows.update(existing.windowId, { focused: true })
    }
  } else {
    await chrome.tabs.create({ url, active: true })
  }
}
