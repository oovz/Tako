import { LoaderCircle, RotateCw } from "lucide-react"
import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react"

import { playPanelMotion } from "../hooks/panel-motion"
import type { SidepanelSeriesContextData } from "../hooks/useSidepanelSeriesContext"
import { t } from "@/src/runtime/i18n"

export function MangaTabContent({
  data,
  visible,
  children,
}: {
  data: SidepanelSeriesContextData
  visible: boolean
  children: ReactNode
}) {
  const content = useRef<HTMLDivElement>(null)
  const wasWaiting = useRef(false)
  const focusAfterRetry = useRef(false)
  const ready = !!data.mangaState && !data.isLoading && !data.isChaptersLoading
  const retrying = data.isRetryingSeries === true
  const showRecovery = retrying || !!data.retrySeriesContext

  const trackRetryFocus = useCallback((button: HTMLButtonElement | null) => {
    if (!button) return
    return () => {
      focusAfterRetry.current = document.activeElement === button
    }
  }, [])

  useLayoutEffect(() => {
    if (!ready) {
      wasWaiting.current = true
      return
    }
    const root = content.current
    const reveal = wasWaiting.current
    const restoreFocus = focusAfterRetry.current
    wasWaiting.current = false
    focusAfterRetry.current = false
    if (!root || !visible) return

    if (restoreFocus) {
      const selectAll = root.querySelector<HTMLButtonElement>(
        "#select-all-ctx:not(:disabled)"
      )
      const focusTarget = selectAll ?? root
      focusTarget.focus({ preventScroll: true })
    }
    if (!reveal) return
    // Give the virtual list a frame to mount its visible rows.
    const frame = requestAnimationFrame(() => {
      Array.from(
        root.querySelectorAll<HTMLElement>(
          ".manga-volume-header, .manga-chapter"
        )
      )
        .filter((row) => !row.closest("[inert]"))
        .slice(0, 4)
        .forEach((row, index) =>
          playPanelMotion(
            row,
            [
              { opacity: 0.6, translate: "0 3px" },
              { opacity: 1, translate: "0 0" },
            ],
            165,
            index * 24
          )
        )
    })
    return () => cancelAnimationFrame(frame)
  }, [ready, visible])

  const RetryIcon = retrying ? LoaderCircle : RotateCw
  return (
    <div className="manga-tab-content" ref={content} tabIndex={-1}>
      {showRecovery ? (
        <div className="manga-load-recovery" data-retrying={retrying}>
          <div>
            <div role="status" aria-atomic="true">
              <h2>
                {t(
                  retrying
                    ? "sidepanel_loadingManga"
                    : "sidepanel_seriesLoadFailed"
                )}
              </h2>
              <p aria-hidden={retrying || undefined}>
                {data.hostPermissionHostname
                  ? t("sidepanel_seriesHostPermissionRequired", [
                      data.hostPermissionHostname,
                    ])
                  : t("sidepanel_retrySeriesDescription")}
              </p>
            </div>
            <button
              ref={trackRetryFocus}
              type="button"
              className="queue-panel-notice-action manga-series-retry"
              aria-disabled={retrying || undefined}
              aria-busy={retrying || undefined}
              onClick={retrying ? undefined : data.retrySeriesContext}
            >
              <RetryIcon size={13} aria-hidden="true" />
              {t(retrying ? "sidepanel_retryingSeries" : "common_retry")}
            </button>
          </div>
        </div>
      ) : (
        children
      )}
    </div>
  )
}
