import logger from "@/src/runtime/logger"

let firefoxDocument:
  | {
      frame: HTMLIFrameElement
      keepAlive: ReturnType<typeof setInterval>
    }
  | undefined

export function firefoxProcessingContexts(): { documentId: string }[] {
  if (!firefoxDocument) return []
  const runtime = chrome.runtime as typeof chrome.runtime & {
    getDocumentId: (frame: HTMLIFrameElement) => string
  }
  return [{ documentId: runtime.getDocumentId(firefoxDocument.frame) }]
}

export async function createProcessingDocument(
  livenessAlarmName: string
): Promise<void> {
  if (!import.meta.env.FIREFOX) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [
        chrome.offscreen.Reason.BLOBS,
        chrome.offscreen.Reason.WORKERS,
        chrome.offscreen.Reason.DOM_PARSER,
      ],
      justification:
        "Create archives in a Web Worker (fflate), handle Blob-based downloads, and parse fetched series page HTML with DOMParser when no content script is available",
    })
    return
  }

  const frame = document.createElement("iframe")
  frame.hidden = true
  frame.src = chrome.runtime.getURL("offscreen.html")
  const loaded = new Promise<void>((resolve, reject) => {
    frame.addEventListener("load", () => resolve(), { once: true })
    frame.addEventListener(
      "error",
      () => reject(new Error("Unable to load chapter processing")),
      { once: true }
    )
  })
  // Firefox resets its event-page idle timer on parent API calls. The
  // lifecycle closes the frame and stops these checks when its work settles.
  const keepAlive = setInterval(() => {
    void chrome.alarms.get(livenessAlarmName).catch((error) => {
      logger.debug(
        "Firefox event page could not read the processing alarm",
        error
      )
    })
  }, 15_000)
  firefoxDocument = { frame, keepAlive }
  try {
    document.documentElement.append(frame)
    await loaded
  } catch (error) {
    await closeProcessingDocument()
    throw error
  }
}

export async function closeProcessingDocument(): Promise<void> {
  if (!import.meta.env.FIREFOX) {
    await chrome.offscreen.closeDocument()
    return
  }
  if (!firefoxDocument) return
  clearInterval(firefoxDocument.keepAlive)
  firefoxDocument.frame.remove()
  firefoxDocument = undefined
}
