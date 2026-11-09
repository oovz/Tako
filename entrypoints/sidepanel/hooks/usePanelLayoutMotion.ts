import { useLayoutEffect, useRef, type RefObject } from "react"

function readLayout(node: HTMLElement) {
  const visual = node.getBoundingClientRect()
  const [x = 0, y = 0] = getComputedStyle(node)
    .getPropertyValue("translate")
    .split(/\s+/)
    .map((value) => parseFloat(value) || 0)
  return {
    rect: new DOMRect(visual.x - x, visual.y - y, visual.width, visual.height),
    x,
    y,
  }
}

/** Animate surviving rows from their previous position without delaying input. */
export function usePanelLayoutMotion(
  root: RefObject<HTMLElement | null>,
  selector: string,
  revision: string
) {
  const previous = useRef(new Map<string, DOMRect>())
  const previousScroll = useRef(0)
  useLayoutEffect(() => {
    const nodes = root.current?.querySelectorAll<HTMLElement>(selector)
    if (!nodes) return
    const animate =
      matchMedia("(prefers-reduced-motion: no-preference)").matches &&
      document.documentElement.dataset.takoMotion !== "reduce" &&
      previousScroll.current === root.current?.scrollTop
    const next = new Map<string, DOMRect>()
    for (const node of nodes) {
      const key = node.dataset.taskId ?? node.id
      const { rect, x: inFlightX, y: inFlightY } = readLayout(node)
      const before = previous.current.get(key)
      if (animate && before && rect.width && rect.height) {
        const x = before.left + inFlightX - rect.left,
          y = before.top + inFlightY - rect.top
        if (
          (x || y) &&
          Math.abs(y) <= (root.current?.clientHeight ?? 0) &&
          Math.abs(x) <= (root.current?.clientWidth ?? 0)
        ) {
          node.getAnimations().forEach((animation) => animation.cancel())
          node.animate(
            [{ translate: x + "px " + y + "px" }, { translate: "0 0" }],
            { duration: 185, easing: "cubic-bezier(.2,0,0,1)" }
          )
        }
      }
      next.set(key, rect)
    }
    previous.current = next
    previousScroll.current = root.current?.scrollTop ?? 0
  }, [root, selector, revision])
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const capture = () => {
      previousScroll.current = element.scrollTop
      previous.current = new Map(
        [...element.querySelectorAll<HTMLElement>(selector)].map((node) => [
          node.dataset.taskId ?? node.id,
          readLayout(node).rect,
        ])
      )
    }
    let width = element.clientWidth
    const resize = new ResizeObserver(() => {
      if (width === element.clientWidth) return
      width = element.clientWidth
      for (const node of element.querySelectorAll<HTMLElement>(selector)) {
        node.getAnimations().forEach((animation) => animation.cancel())
      }
      capture()
    })
    resize.observe(element)
    element.addEventListener("pointerdown", capture, true)
    element.addEventListener("keydown", capture, true)
    return () => {
      resize.disconnect()
      element.removeEventListener("pointerdown", capture, true)
      element.removeEventListener("keydown", capture, true)
    }
  }, [root, selector])
}
