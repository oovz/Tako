import { useEffect } from "react"

import {
  getOptionsActionItemSeverity,
  OPTIONS_ACTION_ITEM_KEYS,
  parseStoredOptionsActionItems,
  type OptionsActionItemSeverity,
  type OptionsActionItems,
} from "@/src/runtime/options-action-items"
import { refreshFolderActionItem } from "@/src/runtime/refresh-folder-action-item"
import { useChromeStorageValue } from "@/src/ui/shared/hooks/useChromeStorageValue"

export function useOptionsActionItemSeverity(): OptionsActionItemSeverity | null {
  const { value } = useChromeStorageValue<OptionsActionItems>({
    areaName: "session",
    key: OPTIONS_ACTION_ITEM_KEYS,
    initialValue: {},
    parse: parseStoredOptionsActionItems,
  })

  useEffect(() => {
    // A file-system grant can change while settings remain the same.
    const refresh = () => void refreshFolderActionItem()
    refresh()
    window.addEventListener("focus", refresh)
    return () => window.removeEventListener("focus", refresh)
  }, [])

  return getOptionsActionItemSeverity(value)
}
