import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react"

const feedbackEvents = {
  queued: {
    messageKey: "sidepanel_addedToQueue",
    tone: "success",
    duration: 4000,
  },
  settingsOpenFailed: {
    messageKey: "sidepanel_settingsOpenFailed",
    tone: "error",
    duration: 8000,
  },
  historyOpenFailed: {
    messageKey: "sidepanel_historyOpenFailed",
    tone: "error",
    duration: 8000,
  },
} as const

type PanelFeedbackEvent = keyof typeof feedbackEvents
export type PanelNotice = (typeof feedbackEvents)[PanelFeedbackEvent] & {
  id: number
  event: PanelFeedbackEvent
}

type ReportFeedback = (event: PanelFeedbackEvent) => void
const ignoreFeedback: ReportFeedback = () => {}
const PanelFeedbackContext = createContext<{
  notices: PanelNotice[]
  report: ReportFeedback
  dismiss: (id: number) => void
} | null>(null)

export function PanelFeedbackProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<PanelNotice[]>([])
  const nextId = useRef(0)
  const report = useCallback<ReportFeedback>((event) => {
    const notice = { ...feedbackEvents[event], id: ++nextId.current, event }
    setNotices((previous) => [
      ...previous.filter((item) => item.event !== event),
      notice,
    ])
  }, [])
  const dismiss = useCallback((id: number) => {
    setNotices((previous) => previous.filter((notice) => notice.id !== id))
  }, [])
  return (
    <PanelFeedbackContext.Provider value={{ notices, report, dismiss }}>
      {children}
    </PanelFeedbackContext.Provider>
  )
}

export function usePanelFeedback(): ReportFeedback {
  return useContext(PanelFeedbackContext)?.report ?? ignoreFeedback
}

export function usePanelNotices() {
  return useContext(PanelFeedbackContext)
}
