import { useCallback, useEffect, useRef, useState } from "react"

const SUCCESS_HIDE_DELAY_MS = 2000

export function useDownloadFeedback() {
  const [showSuccess, setShowSuccess] = useState(false)
  const [isEnqueuing, setIsEnqueuing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const clearSuccessTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearSuccessTimeout()
    }
  }, [clearSuccessTimeout])

  const begin = useCallback(() => {
    setIsEnqueuing(true)
    setShowSuccess(false)
    setErrorMessage(null)
    clearSuccessTimeout()
  }, [clearSuccessTimeout])

  const succeed = useCallback(() => {
    if (!mountedRef.current) return
    setShowSuccess(true)
    timeoutRef.current = setTimeout(() => {
      if (mountedRef.current) setShowSuccess(false)
      timeoutRef.current = null
    }, SUCCESS_HIDE_DELAY_MS)
  }, [])

  const fail = useCallback((message: string) => {
    if (mountedRef.current) setErrorMessage(message)
  }, [])

  const finish = useCallback(() => {
    if (mountedRef.current) setIsEnqueuing(false)
  }, [])

  return {
    showSuccess,
    isEnqueuing,
    errorMessage,
    begin,
    succeed,
    fail,
    finish,
  }
}
