import { CircleAlert, LoaderCircle, RotateCw, X } from "lucide-react"
import { useLayoutEffect, useRef, useState } from "react"
import { t } from "@/src/runtime/i18n"
import logger from "@/src/runtime/logger"
import type { StorageReadStatus } from "@/src/ui/shared/hooks/useChromeStorageValue"
import "./QueuePanelNotice.css"

export function QueuePanelNotice({
  readStatus,
  reorderConflict,
  onRetry,
  onDismissConflict,
}: {
  readStatus: StorageReadStatus
  reorderConflict: boolean
  onRetry: () => Promise<void>
  onDismissConflict: () => void
}) {
  const readNotice =
    readStatus === "error" || readStatus === "stale" ? readStatus : null
  const conflict = reorderConflict ? "conflict" : null
  const [lastNotice, setLastNotice] = useState(readNotice ?? conflict)
  const [retrying, setRetrying] = useState(false)
  const retryInFlight = useRef(false)
  const strip = useRef<HTMLDivElement>(null)
  // A retry can publish a loading snapshot before it publishes the result.
  const notice =
    readNotice ??
    (retrying && readStatus === "loading" ? lastNotice : null) ??
    conflict
  // Keep the content mounted while the strip slides back under the tabs.
  if (notice !== null && notice !== lastNotice) setLastNotice(notice)
  const displayedNotice = notice ?? lastNotice
  const dismiss = displayedNotice === "conflict"
  const pending = retrying && !dismiss
  const ActionIcon = dismiss ? X : pending ? LoaderCircle : RotateCw

  useLayoutEffect(() => {
    const element = strip.current
    if (!element) return
    if (notice === null && element.contains(document.activeElement)) {
      const tabId = element
        .closest('[role="tabpanel"]')
        ?.getAttribute("aria-labelledby")
      if (tabId) document.getElementById(tabId)?.focus({ preventScroll: true })
    }
    element.inert = notice === null
  }, [notice])

  async function retry() {
    if (retryInFlight.current) return
    retryInFlight.current = true
    setRetrying(true)
    try {
      await onRetry()
    } catch (error) {
      logger.warn("[Queue] Could not refresh the queue projection:", error)
    } finally {
      retryInFlight.current = false
      setRetrying(false)
    }
  }

  return (
    <div ref={strip} className="queue-panel-notice" data-open={notice !== null}>
      <div className="queue-panel-notice-clip">
        <div className="queue-panel-notice-body">
          {displayedNotice && (
            <>
              <CircleAlert size={15} aria-hidden="true" />
              <p role={notice === null ? undefined : "alert"}>
                {t(
                  displayedNotice === "error"
                    ? "queue_readFailed"
                    : displayedNotice === "stale"
                      ? "queue_readStale"
                      : "sidepanel_queueChanged"
                )}
              </p>
              <button
                type="button"
                className="queue-panel-notice-action"
                aria-busy={pending || undefined}
                aria-disabled={pending || undefined}
                onClick={dismiss ? onDismissConflict : () => void retry()}
              >
                <ActionIcon size={13} aria-hidden="true" />
                {t(dismiss ? "common_dismiss" : "common_retry")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
