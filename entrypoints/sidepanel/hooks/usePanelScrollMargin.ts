import { useLayoutEffect, useState, type RefObject } from "react"

/** Keep virtual rows in the same scroll flow as their variable-height header. */
export function usePanelScrollMargin(
  scroller: HTMLDivElement | null | undefined,
  list: RefObject<HTMLDivElement | null>
) {
  const [margin, setMargin] = useState(0)
  useLayoutEffect(() => {
    const parent = scroller
    const element = list.current
    if (!parent || !element) return
    const measure = () => {
      const next =
        element.getBoundingClientRect().top -
        parent.getBoundingClientRect().top +
        parent.scrollTop
      setMargin((previous) =>
        Math.abs(previous - next) < 0.5 ? previous : next
      )
    }
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    for (const child of parent.children) observer.observe(child)
    const frame = requestAnimationFrame(measure)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [scroller, list])
  return margin
}
