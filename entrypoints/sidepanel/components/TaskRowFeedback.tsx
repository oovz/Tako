import { ChevronDown, CircleAlert, Loader2, TriangleAlert } from "lucide-react"
import type { ReactNode, Ref } from "react"
import {
  getTaskFeedbackActions,
  type CommandCenterTaskActionsProps,
  type RecoveryTaskLink,
} from "./CommandCenterTaskActions"
import { TaskRowReveal } from "./TaskRowReveal"

export interface TaskFeedback {
  summary: string
  tone: "error" | "warning"
  description?: string | null
  guidance?: string | null
  messages: string[]
}

export function TaskRowFeedbackButton({
  feedback,
  panelId,
  open,
  triggerRef,
  onToggle,
}: {
  feedback: TaskFeedback
  panelId: string
  open: boolean
  triggerRef: Ref<HTMLButtonElement>
  onToggle: () => void
}) {
  const Icon = feedback.tone === "error" ? CircleAlert : TriangleAlert
  return (
    <button
      ref={triggerRef}
      type="button"
      data-task-feedback-trigger
      data-tone={feedback.tone}
      className="task-feedback-trigger"
      aria-label={feedback.summary}
      aria-expanded={open}
      aria-controls={panelId}
      title={feedback.summary}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (!open || event.key !== "Escape") return
        event.stopPropagation()
        onToggle()
      }}
    >
      <Icon aria-hidden="true" />
      <ChevronDown aria-hidden="true" />
    </button>
  )
}

export function TaskRowFeedback({
  feedback,
  panelId,
  open,
  taskActions,
  recoveryLinks,
  terminal,
  onClose,
  children,
}: {
  feedback: TaskFeedback
  panelId: string
  open: boolean
  taskActions: CommandCenterTaskActionsProps
  recoveryLinks: RecoveryTaskLink[]
  terminal: boolean
  onClose: () => void
  children?: ReactNode
}) {
  const actions = getTaskFeedbackActions(taskActions, recoveryLinks, terminal)
  return (
    <TaskRowReveal
      id={panelId}
      data-task-feedback-panel
      open={open}
      label={feedback.summary}
      onEscape={onClose}
    >
      <strong>{feedback.summary}</strong>
      {feedback.description && <p>{feedback.description}</p>}
      {feedback.guidance && <p>{feedback.guidance}</p>}
      {feedback.messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
      {children}
      {actions.length > 0 && (
        <div className="task-feedback-actions">
          {actions.map((action, index) => (
            <button
              key={action.id}
              type="button"
              className={
                action.id === "cancel" ? "destructive-action" : undefined
              }
              data-primary={index === 0 || undefined}
              aria-label={action.label}
              aria-busy={action.pending || undefined}
              disabled={action.pending}
              onClick={() => void action.invoke()}
            >
              {action.pending ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <action.Icon aria-hidden="true" />
              )}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </TaskRowReveal>
  )
}
