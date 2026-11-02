import { useEffect, useState } from "react"
import type { UiPreferences } from "@/src/runtime/runtime-message-contracts"
import {
  DEFAULT_UI_PREFERENCES,
  loadUiPreferences,
} from "@/src/ui/shared/ui-preferences-client"

const SETTINGS_CHANGE_SIGNAL_KEY = "settings:global"

type PreferenceReadResult =
  { value: UiPreferences; error: null } | { error: Error }

interface PreferenceState {
  value: UiPreferences
  hydrated: boolean
  error: Error | null
}

async function readPreferences(): Promise<PreferenceReadResult> {
  try {
    return { value: await loadUiPreferences(), error: null }
  } catch (cause) {
    return { error: cause instanceof Error ? cause : new Error(String(cause)) }
  }
}

function subscribeToPreferences(
  onRead: (result: PreferenceReadResult) => void
) {
  let active = true
  let requestGeneration = 0

  const refresh = async (): Promise<void> => {
    const generation = ++requestGeneration
    const result = await readPreferences()
    if (!active || generation !== requestGeneration) return
    onRead(result)
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
}

export function useUiPreferences() {
  const [state, setState] = useState<PreferenceState>({
    value: DEFAULT_UI_PREFERENCES,
    hydrated: false,
    error: null,
  })

  useEffect(
    () =>
      subscribeToPreferences((result) => {
        setState((current) => ({ ...current, ...result, hydrated: true }))
      }),
    []
  )

  return state
}
