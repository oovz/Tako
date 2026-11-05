import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { t } from "@/src/runtime/i18n"

export function useDownloadFeedback() {
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
    toast.success(t("sidepanel_addedToQueue"), {
      position: "bottom-center",
    })
  }, [])

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
