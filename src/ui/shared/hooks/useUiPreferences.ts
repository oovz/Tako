import { useEffect, useRef, useState } from "react"
import type { UiPreferences } from "@/src/runtime/runtime-message-contracts"
import {
  DEFAULT_UI_PREFERENCES,
  loadUiPreferences,
} from "@/src/ui/shared/ui-preferences-client"

const SETTINGS_CHANGE_SIGNAL_KEY = "settings:global"

export function useUiPreferences() {
  const [value, setValue] = useState<UiPreferences>(DEFAULT_UI_PREFERENCES)
  const [hydrated, setHydrated] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const requestGeneration = useRef(0)

  useEffect(() => {
    let active = true

    const refresh = async (): Promise<void> => {
      const generation = ++requestGeneration.current
      try {
        const next = await loadUiPreferences()
        if (!active || generation !== requestGeneration.current) return
        setValue(next)
        setError(null)
      } catch (cause) {
        if (!active || generation !== requestGeneration.current) return
        setError(cause instanceof Error ? cause : new Error(String(cause)))
      } finally {
        if (active && generation === requestGeneration.current) {
          setHydrated(true)
        }
      }
    }

    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ): void => {
      if (areaName !== "local" || !(SETTINGS_CHANGE_SIGNAL_KEY in changes)) {
        return
      }
      void refresh()
    }

    chrome.storage.onChanged.addListener(onChanged)
    void refresh()
    return () => {
      active = false
      chrome.storage.onChanged.removeListener(onChanged)
    }
  }, [])

  return { value, hydrated, error }
}
