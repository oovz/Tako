import React, { useEffect, useId, useRef } from "react"

import { Button } from "@/components/ui/button"

interface InlineConfirmationProps {
  title: string
  description?: string
  confirmLabel?: string
  pendingLabel?: string
  cancelLabel?: string
  isPending?: boolean
  errorMessage?: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function InlineConfirmation({
  title,
  description,
  confirmLabel = "Yes",
  pendingLabel,
  cancelLabel = "No",
  isPending = false,
  errorMessage,
  onConfirm,
  onCancel,
}: InlineConfirmationProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()

    return () => {
      if (
        triggerRef.current &&
        typeof triggerRef.current.focus === "function"
      ) {
        triggerRef.current.focus()
      }
    }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (!isPending) {
        onCancel()
      }
      return
    }
    if (e.key === "Tab") {
      e.preventDefault()
      if (document.activeElement === cancelRef.current) {
        confirmRef.current?.focus()
      } else {
        cancelRef.current?.focus()
      }
    }
  }

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      aria-describedby={description || errorMessage ? descriptionId : undefined}
      onKeyDown={handleKeyDown}
      aria-busy={isPending}
      className="absolute inset-0 z-20 rounded-md border border-border bg-background/95 p-2 backdrop-blur-sm"
    >
      <div className="flex h-full flex-wrap items-center justify-between gap-1.5">
        <div className="min-w-0">
          <p id={titleId} className="text-xs font-medium text-foreground">
            {title}
          </p>
          <div id={descriptionId}>
            {description ? (
              <p className="text-[11px] text-muted-foreground">{description}</p>
            ) : null}
            {errorMessage ? (
              <p
                role="status"
                aria-live="polite"
                className="text-[11px] text-destructive"
              >
                {errorMessage}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            ref={cancelRef}
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 px-2 text-xs"
            onClick={onCancel}
            disabled={isPending}
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            size="sm"
            variant="destructive"
            className="h-7 px-2 text-xs"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending && pendingLabel ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
