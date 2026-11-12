import { useCallback, useEffect, useRef, useState } from "react"
import { usePanelFeedback } from "../components/PanelFeedback"

export function useDownloadFeedback() {
  const reportFeedback = usePanelFeedback()
  const [isEnqueuing, setIsEnqueuing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const begin = useCallback(() => {
    setIsEnqueuing(true)
    setErrorMessage(null)
  }, [])

  const succeed = useCallback(() => {
    if (!mountedRef.current) return
    reportFeedback("queued")
  }, [reportFeedback])

  const fail = useCallback((message: string) => {
    if (mountedRef.current) setErrorMessage(message)
  }, [])

  const finish = useCallback(() => {
    if (mountedRef.current) setIsEnqueuing(false)
  }, [])

  return {
    isEnqueuing,
    errorMessage,
    begin,
    succeed,
    fail,
    finish,
  }
}
