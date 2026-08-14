import type { UiPreferences } from "@/src/runtime/runtime-message-contracts"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"

export const DEFAULT_UI_PREFERENCES: UiPreferences = Object.freeze({
  motionPreference: "system",
  uiLanguage: "auto",
})

export async function loadUiPreferences(): Promise<UiPreferences> {
  const response = await sendRuntimeMessage({
    target: "background",
    type: "GET_UI_PREFERENCES",
  })
  if (!response.success) throw new Error(response.error)
  return response.data
}
