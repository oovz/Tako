import { type TransitionEvent, useCallback, useRef, useState } from "react"

function prefersReducedMotion() {
  if (typeof window === "undefined") return false

  return (
    document.documentElement.dataset.takoMotion === "reduce" ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  )
}

export const INLINE_SELECTION_LAYOUT_TRANSITION_PROPERTY = "flex-grow"

export function shouldUnmountInlineSelectionAfterTransition(
  event: Pick<TransitionEvent, "propertyName">,
  isOpen: boolean,
  state: "open" | "closed"
): boolean {
  return (
    event.propertyName === INLINE_SELECTION_LAYOUT_TRANSITION_PROPERTY &&
    !isOpen &&
    state === "closed"
  )
}

export function useInlineSelectionPresence(
  isOpen: boolean,
  setOpen: (open: boolean) => void
) {
  const [isInlineSelectionPresent, setInlineSelectionPresent] = useState(isOpen)
  const isInlineSelectionVisible = isOpen || isInlineSelectionPresent
  const updateInlineSelectionOpen = useCallback(
    (open: boolean) => {
      if (open || prefersReducedMotion()) {
        setInlineSelectionPresent(open)
      }
      setOpen(open)
    },
    [setOpen]
  )
  const inlineSelectionTriggerRef = useRef<HTMLButtonElement>(null)
  const closeInlineSelectionAndRestoreFocus = useCallback(() => {
    updateInlineSelectionOpen(false)
    inlineSelectionTriggerRef.current?.focus()
  }, [updateInlineSelectionOpen])
  const handleInlineSelectionTransitionEnd = useCallback(
    (event: TransitionEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return

      const state = event.currentTarget.dataset.state as "open" | "closed"
      if (shouldUnmountInlineSelectionAfterTransition(event, isOpen, state)) {
        setInlineSelectionPresent(false)
      }
    },
    [isOpen]
  )
  return {
    isInlineSelectionVisible,
    updateInlineSelectionOpen,
    inlineSelectionTriggerRef,
    closeInlineSelectionAndRestoreFocus,
    handleInlineSelectionTransitionEnd,
  }
}
