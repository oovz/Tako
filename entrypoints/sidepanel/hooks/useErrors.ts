import { useCallback, useEffect, useState } from "react"
import logger from "@/src/runtime/logger"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { createCommandEnvelope } from "@/src/runtime/command-envelope"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import type {
  PersistentError,
  PersistentErrorSeverity,
} from "@/src/runtime/persistent-error-schema"

export type UIPersistentErrorSeverity = PersistentErrorSeverity
export type UIPersistentError = PersistentError

const STORAGE_KEY = LOCAL_STORAGE_KEYS.persistentErrors

export function useErrors() {
  const [errors, setErrors] = useState<UIPersistentError[]>([])

  useEffect(() => {
    let isMounted = true
    let generation = 0

    const load = async () => {
      const requestGeneration = ++generation
      try {
        const response = await sendRuntimeMessage({
          target: "background",
          type: "GET_PERSISTENT_ERRORS",
        })
        if (!isMounted || requestGeneration !== generation) return
        if (!response.success) throw new Error(response.error)
        setErrors(response.data)
      } catch (error) {
        if (!isMounted || requestGeneration !== generation) return
        logger.error("Failed to load persistent errors:", error)
      }
    }

    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName !== "local") return
      const change = changes[STORAGE_KEY]
      if (!change) return
      void load()
    }

    chrome.storage.onChanged.addListener(listener)
    // Fire-and-forget: React useEffect is sync; async error load runs in background
    void load()

    return () => {
      isMounted = false
      chrome.storage.onChanged.removeListener(listener)
    }
  }, [])

  const acknowledgeError = useCallback(async (code: string) => {
    if (!code) return
    try {
      const response = await sendRuntimeMessage({
        target: "background",
        type: "ACKNOWLEDGE_ERROR",
        ...createCommandEnvelope(),
        payload: { code },
      })
      if (!response.success) {
        logger.debug("Failed to acknowledge persistent error:", response.error)
      }
    } catch (error) {
      logger.debug("Failed to send ACKNOWLEDGE_ERROR message:", error)
    }
  }, [])

  return { errors, acknowledgeError }
}
