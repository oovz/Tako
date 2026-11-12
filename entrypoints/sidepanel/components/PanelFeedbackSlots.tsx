import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

export interface FeedbackSlotContent {
  key: string
  content: ReactNode
}

type FeedbackSlot = FeedbackSlotContent & { leaving?: true }

function mergeSlots(
  previous: FeedbackSlot[],
  incoming: FeedbackSlotContent[]
): FeedbackSlot[] {
  const incomingKeys = new Set(incoming.map((item) => item.key))
  const slots: FeedbackSlot[] = [...incoming]
  previous.forEach((item, index) => {
    if (!incomingKeys.has(item.key))
      slots.splice(index, 0, { ...item, leaving: true })
  })
  return slots
}

function FeedbackSlotTrack({
  slot,
  onExit,
}: {
  slot: FeedbackSlot
  onExit: (key: string) => void
}) {
  const track = useRef<HTMLDivElement>(null)
  const { key, leaving } = slot
  useLayoutEffect(() => {
    if (!leaving) return
    // Follow the actual height transition, including reversals and changes
    // to the motion preference. With no transition, remove immediately.
    const animations = track.current?.getAnimations?.() ?? []
    if (animations.length === 0) {
      onExit(key)
      return
    }
    let current = true
    void Promise.allSettled(
      animations.map((animation) => animation.finished)
    ).then(() => {
      if (current) onExit(key)
    })
    return () => {
      current = false
    }
  }, [key, leaving, onExit])

  return (
    <div
      ref={track}
      className="panel-feedback-slot"
      data-leaving={leaving}
      inert={leaving}
      aria-hidden={leaving}
    >
      <div className="panel-feedback-clip">
        <div className="panel-feedback-slide">{slot.content}</div>
      </div>
    </div>
  )
}

export function PanelFeedbackSlots({
  items,
}: {
  items: FeedbackSlotContent[]
}) {
  const [snapshot, setSnapshot] = useState<{
    items: FeedbackSlotContent[]
    slots: FeedbackSlot[]
  }>({
    items,
    slots: items,
  })
  const slots =
    snapshot.items === items
      ? snapshot.slots
      : mergeSlots(snapshot.slots, items)
  if (snapshot.items !== items) setSnapshot({ items, slots })
  const completeExit = useCallback(
    (key: string) =>
      setSnapshot((current) => ({
        ...current,
        slots: current.slots.filter(
          (item) => item.key !== key || !item.leaving
        ),
      })),
    []
  )
  return slots.map((slot) => (
    <FeedbackSlotTrack key={slot.key} slot={slot} onExit={completeExit} />
  ))
}
