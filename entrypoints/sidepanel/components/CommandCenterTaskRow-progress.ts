import { useCallback, useEffect, useState, useSyncExternalStore } from "react"

class TaskRowProgressClock {
  private visibleSince: number | null = null
  private visible = false
  private hideTimer: ReturnType<typeof setTimeout> | undefined
  private readonly listeners = new Set<() => void>()

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): boolean {
    return this.visible
  }

  private publish(visible: boolean): void {
    if (this.visible === visible) return
    this.visible = visible
    this.listeners.forEach((listener) => listener())
  }

  private finishWindow(): void {
    this.visibleSince = null
    this.hideTimer = undefined
    this.publish(false)
  }

  cancelPendingHide(): void {
    if (this.hideTimer === undefined) return
    clearTimeout(this.hideTimer)
    this.hideTimer = undefined
  }

  update(showProgress: boolean): void {
    this.cancelPendingHide()
    if (showProgress) {
      if (this.visibleSince === null) this.visibleSince = Date.now()
      this.publish(true)
      return
    }
    if (this.visibleSince === null) return

    // Brief gaps retain the first visible time of this progress window.
    const remaining = 500 - (Date.now() - this.visibleSince)
    if (remaining <= 0) this.finishWindow()
    else this.hideTimer = setTimeout(() => this.finishWindow(), remaining)
  }
}

export function useTaskRowProgressVisibility(showProgress: boolean): boolean {
  const [clock] = useState(() => new TaskRowProgressClock())
  const subscribe = useCallback(
    (listener: () => void) => clock.subscribe(listener),
    [clock]
  )
  const getSnapshot = useCallback(() => clock.getSnapshot(), [clock])
  const heldVisible = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    clock.update(showProgress)
    return () => clock.cancelPendingHide()
  }, [clock, showProgress])

  return showProgress || heldVisible
}
