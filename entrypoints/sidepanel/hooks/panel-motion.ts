const animations = new WeakMap<Element, Animation>()

export function stopPanelMotion(element: Element) {
  animations.get(element)?.cancel()
}
export function playPanelMotion(
  element: HTMLElement,
  frames: Keyframe[],
  duration: number,
  delay = 0
) {
  stopPanelMotion(element)
  if (
    !matchMedia("(prefers-reduced-motion: no-preference)").matches ||
    document.documentElement.dataset.takoMotion === "reduce"
  )
    return
  const animation = element.animate(frames, {
    duration,
    delay,
    easing: "cubic-bezier(.2,0,0,1)",
    fill: delay ? "backwards" : "none",
  })
  void animation.finished.catch(() => {})
  animations.set(element, animation)
}
