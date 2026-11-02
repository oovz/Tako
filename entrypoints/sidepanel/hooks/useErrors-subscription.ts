import logger from "@/src/runtime/logger"
import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { createCommandEnvelope } from "@/src/runtime/command-envelope"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import type { PersistentError } from "@/src/runtime/persistent-error-schema"

async function refreshPersistentErrors(
  accept: () => boolean,
  onErrors: (errors: PersistentError[]) => void
): Promise<void> {
  try {
    const response = await sendRuntimeMessage({
      target: "background",
      type: "GET_PERSISTENT_ERRORS",
    })
    if (!accept()) return
    if (!response.success) throw new Error(response.error)
    onErrors(response.data)
  } catch (error) {
    if (accept()) logger.error("Failed to load persistent errors:", error)
  }
}

export function subscribePersistentErrors(
  onErrors: (errors: PersistentError[]) => void
): () => void {
  let active = true
  let generation = 0
  const load = () => {
    const requestGeneration = ++generation
    void refreshPersistentErrors(
      () => active && generation === requestGeneration,
      onErrors
    )
  }
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ) => {
    if (areaName === "local" && changes[LOCAL_STORAGE_KEYS.persistentErrors])
      load()
  }
  chrome.storage.onChanged.addListener(listener)
  load()
  return () => {
    active = false
    chrome.storage.onChanged.removeListener(listener)
  }
}

export async function acknowledgePersistentError(code: string): Promise<void> {
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
}
