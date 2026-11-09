import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react"

const easing = "cubic-bezier(.2,0,0,1)"
const allowsMotion = () =>
  matchMedia("(prefers-reduced-motion: no-preference)").matches &&
  document.documentElement.dataset.takoMotion !== "reduce"

function watchMotionPreference(changed: () => void) {
  const media = matchMedia("(prefers-reduced-motion: reduce)")
  const observer = new MutationObserver(changed)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-tako-motion"],
  })
  media.addEventListener("change", changed)
  return () => {
    observer.disconnect()
    media.removeEventListener("change", changed)
  }
}

/** Move only the selected surface; labels and keyboard focus stay in place. */
export function useOptionsIndicator<Element extends HTMLElement = HTMLElement>(
  value: string,
  selector: string
) {
  const root = useRef<Element>(null)
  const previousValue = useRef(value)
  const animation = useRef<Animation | null>(null)
  useLayoutEffect(() => {
    const container = root.current
    const selected = container?.querySelector<HTMLElement>(selector)
    const indicator =
      container?.querySelector<HTMLElement>(".options-indicator")
    if (!container || !selected || !indicator) return
    const changed = previousValue.current !== value
    previousValue.current = value
    let target = ""
    const position = (animate: boolean) => {
      const bounds = selected.getBoundingClientRect()
      const parent = container.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return
      const left =
        bounds.left - parent.left - container.clientLeft + container.scrollLeft
      const top =
        bounds.top - parent.top - container.clientTop + container.scrollTop
      const next = [left, top, bounds.width, bounds.height].join(",")
      if (next === target) return
      target = next
      const from = indicator.getBoundingClientRect()
      const ready = container.dataset.indicatorReady === "true"
      animation.current?.cancel()
      Object.assign(indicator.style, {
        left: left + "px",
        top: top + "px",
        width: bounds.width + "px",
        height: bounds.height + "px",
      })
      container.dataset.indicatorReady = "true"
      if (!animate || !ready || !allowsMotion()) return
      const to = indicator.getBoundingClientRect()
      animation.current = indicator.animate(
        [
          {
            transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
          },
          { transform: "none" },
        ],
        { duration: 230, easing }
      )
      void animation.current.finished.catch(() => {})
    }
    position(changed)
    const observer = new ResizeObserver(() => position(false))
    observer.observe(container)
    for (const child of container.children) {
      if (child !== indicator) observer.observe(child)
    }
    const unwatch = watchMotionPreference(() => {
      if (!allowsMotion()) animation.current?.cancel()
    })
    return () => {
      observer.disconnect()
      unwatch()
    }
  }, [root, value, selector])
  useEffect(
    () => () => {
      animation.current?.cancel()
    },
    []
  )
  return root
}

/** Keep preview values immediate and coalesce feedback during typing/dragging. */
export function useOptionsPreview(value: string) {
  const root = useRef<HTMLDivElement>(null)
  const previousValue = useRef(value)
  useEffect(() => {
    if (previousValue.current === value) return
    previousValue.current = value
    let animation: Animation | undefined
    const unwatch = watchMotionPreference(() => {
      if (!allowsMotion()) animation?.cancel()
    })
    const timer = setTimeout(() => {
      if (!root.current || !allowsMotion()) return
      animation = root.current.animate([{ opacity: 0.65 }, { opacity: 1 }], {
        duration: 165,
        easing,
      })
      void animation.finished.catch(() => {})
    }, 120)
    return () => {
      clearTimeout(timer)
      animation?.cancel()
      unwatch()
    }
  }, [root, value])
  return root
}

export function useOptionsMotionEnabled() {
  return useSyncExternalStore(watchMotionPreference, allowsMotion, () => false)
}
