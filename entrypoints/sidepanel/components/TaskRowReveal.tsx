import type { ReactNode } from "react"

export function TaskRowReveal({
  id,
  open,
  label,
  busy,
  onEscape,
  children,
  "data-task-feedback-panel": feedbackPanel,
}: {
  id: string
  open: boolean
  label: string
  busy?: boolean
  onEscape: () => void
  children: ReactNode
  "data-task-feedback-panel"?: true
}) {
  return (
    <div
      id={id}
      className="task-row-reveal"
      data-open={open}
      data-task-feedback-panel={feedbackPanel}
      inert={!open}
    >
      <div>
        <div
          className="task-row-panel"
          role="group"
          aria-label={label}
          aria-busy={busy}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || busy) return
            event.stopPropagation()
            onEscape()
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
