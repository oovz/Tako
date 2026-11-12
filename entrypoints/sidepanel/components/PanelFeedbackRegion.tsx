import { useEffect, useRef, useState, type ReactNode } from "react"
import { Check, CircleAlert, RotateCw, X } from "lucide-react"
import { t } from "@/src/runtime/i18n"
import { getDownloadErrorMessage } from "@/src/runtime/download-error-presentation"
import { normalizeDownloadErrorCategory } from "@/src/shared/download-contract"
import { useErrors } from "../hooks/useErrors"
import { useInitFailure } from "../hooks/useInitFailure"
import { usePanelNotices, type PanelNotice } from "./PanelFeedback"
import { QueueUndoRegion } from "./QueueUndo"
import {
  PanelFeedbackSlots,
  type FeedbackSlotContent,
} from "./PanelFeedbackSlots"

function FeedbackRow({
  tone,
  message,
  action,
  onDismiss,
}: {
  tone: "success" | "warning" | "error"
  message: string
  action?: ReactNode
  onDismiss?: () => void
}) {
  const Icon = tone === "success" ? Check : CircleAlert
  return (
    <div className="panel-feedback-row" data-tone={tone}>
      <Icon size={15} aria-hidden="true" />
      <p role={tone === "error" ? "alert" : "status"}>{message}</p>
      {action}
      {onDismiss && (
        <button
          type="button"
          className="panel-feedback-dismiss"
          aria-label={t("common_dismiss")}
          onClick={(event) => {
            if (document.activeElement === event.currentTarget) {
              document
                .querySelector<HTMLButtonElement>(
                  '.panel-tabs [aria-selected="true"]'
                )
                ?.focus()
            }
            onDismiss()
          }}
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

function TimedFeedback({
  notice,
  dismiss,
}: {
  notice: PanelNotice
  dismiss: (id: number) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const remaining = useRef<number>(notice.duration)
  const { id } = notice
  useEffect(() => {
    if (hovered || focused) return
    const beganAt = Date.now()
    const timer = setTimeout(() => dismiss(id), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(
        0,
        remaining.current - (Date.now() - beganAt)
      )
    }
  }, [dismiss, focused, hovered, id])

  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false)
      }}
    >
      <FeedbackRow
        tone={notice.tone}
        message={t(notice.messageKey)}
        onDismiss={() => dismiss(id)}
      />
    </div>
  )
}

function getPersistentErrorMessage(code: string): string {
  return normalizeDownloadErrorCategory(code)
    ? getDownloadErrorMessage(code)
    : t("sidepanel_persistentError")
}

export function PanelFeedbackRegion() {
  const feedback = usePanelNotices()
  const { errors, acknowledgeError } = useErrors()
  const { initFailed } = useInitFailure()
  const items: FeedbackSlotContent[] = []
  if (initFailed)
    items.push({
      key: "initialization",
      content: (
        <FeedbackRow
          tone="error"
          message={t("sidepanel_initFailed")}
          action={
            <button
              type="button"
              className="panel-feedback-action"
              onClick={() => chrome.runtime.reload()}
            >
              <RotateCw size={13} aria-hidden="true" />
              <span>{t("sidepanel_reloadExtension")}</span>
            </button>
          }
        />
      ),
    })
  for (const error of errors) {
    if (error.code === "FSA_HANDLE_INVALID") continue
    items.push({
      key: "stored:" + error.code,
      content: (
        <FeedbackRow
          tone={error.severity}
          message={getPersistentErrorMessage(error.code)}
          onDismiss={() => void acknowledgeError(error.code)}
        />
      ),
    })
  }
  if (feedback) {
    for (const notice of feedback.notices) {
      items.push({
        key: "timed:" + notice.event,
        content: (
          <TimedFeedback
            key={notice.id}
            notice={notice}
            dismiss={feedback.dismiss}
          />
        ),
      })
    }
  }
  return (
    <div className="panel-feedback-stack" data-panel-feedback>
      <PanelFeedbackSlots items={items} />
      <QueueUndoRegion />
    </div>
  )
}
