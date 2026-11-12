import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Check, CircleAlert, Undo2 } from "lucide-react"
import type { PendingUndoReceipt } from "@/src/domain/queue/state"
import { queueCommandClient } from "@/src/ui/shared/queue-command-client"
import { t } from "@/src/runtime/i18n"
import { PanelFeedbackSlots } from "./PanelFeedbackSlots"

interface Offer {
  receipt: PendingUndoReceipt
  taskId: string
}
interface UndoContext {
  offers: Offer[]
  show: (receipt: PendingUndoReceipt, taskId: string) => void
  update: (receipt: PendingUndoReceipt) => void
  remove: (token: string) => void
}
const Context = createContext<UndoContext | null>(null)
export function QueueUndoProvider({ children }: { children: ReactNode }) {
  const [offers, setOffers] = useState<Offer[]>([])
  const show = useCallback((receipt: PendingUndoReceipt, taskId: string) => {
    setOffers((previous) => [
      ...previous.filter((offer) => offer.receipt.token !== receipt.token),
      { receipt, taskId },
    ])
  }, [])
  const update = useCallback((receipt: PendingUndoReceipt) => {
    setOffers((previous) =>
      previous.map((offer) =>
        offer.receipt.token === receipt.token ? { ...offer, receipt } : offer
      )
    )
  }, [])
  const remove = useCallback(
    (token: string) =>
      setOffers((previous) =>
        previous.filter((offer) => offer.receipt.token !== token)
      ),
    []
  )
  return (
    <Context.Provider value={{ offers, show, update, remove }}>
      {children}
    </Context.Provider>
  )
}
export function useQueueUndo() {
  return useContext(Context)?.show
}

function UndoOffer({
  offer,
  update,
  remove,
}: Pick<UndoContext, "update" | "remove"> & { offer: Offer }) {
  const [focused, setFocused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [pending, setPending] = useState(false)
  const [expired, setExpired] = useState(false)
  const [failed, setFailed] = useState(false)
  const undoButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    undoButton.current?.focus()
  }, [])
  const protectedOffer = focused || hovered || pending
  const token = offer.receipt.token
  useEffect(() => {
    if (!focused && !hovered) return
    let disposed = false
    let renewing = false
    const renew = async () => {
      if (renewing) return
      renewing = true
      try {
        const receipt = await queueCommandClient.renewUndo(token)
        if (!disposed) update(receipt)
      } catch {
        if (!disposed) setExpired(true)
      } finally {
        renewing = false
      }
    }
    void renew()
    const timer = setInterval(() => void renew(), 2000)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [focused, hovered, token, update])
  useEffect(() => {
    if (protectedOffer) return
    const timer = setTimeout(
      () => remove(token),
      Math.max(0, offer.receipt.expiresAt - Date.now())
    )
    return () => clearTimeout(timer)
  }, [protectedOffer, offer.receipt.expiresAt, token, remove])
  return (
    <div
      className="queue-undo panel-feedback-row"
      data-tone={failed ? "error" : "success"}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false)
      }}
    >
      {failed ? (
        <CircleAlert size={15} aria-hidden="true" />
      ) : (
        <Check size={15} aria-hidden="true" />
      )}
      <p role={failed ? "alert" : "status"}>
        {t(
          failed
            ? "sidepanel_undoFailed"
            : expired
              ? "sidepanel_undoExpired"
              : offer.receipt.type === "cancel_queued"
                ? "sidepanel_taskRemovedFromQueue"
                : "sidepanel_historyRemoved"
        )}
      </p>
      <button
        ref={undoButton}
        type="button"
        className="panel-feedback-action"
        aria-disabled={pending || expired}
        onClick={async () => {
          if (pending || expired) return
          setPending(true)
          setFailed(false)
          try {
            await queueCommandClient.undoQueueAction(token)
            remove(token)
            // The restored projection may arrive after the command response.
            document.getElementById("panel-tab-queue")?.focus()
          } catch {
            setFailed(true)
          } finally {
            setPending(false)
          }
        }}
      >
        <Undo2 size={13} aria-hidden="true" />
        <span>{t("common_undo")}</span>
      </button>
    </div>
  )
}
export function QueueUndoRegion() {
  const context = useContext(Context)
  if (!context) return null
  return (
    <div className="queue-undo-region">
      <PanelFeedbackSlots
        items={context.offers.map((offer) => ({
          key: offer.receipt.token,
          content: (
            <UndoOffer
              offer={offer}
              update={context.update}
              remove={context.remove}
            />
          ),
        }))}
      />
    </div>
  )
}
