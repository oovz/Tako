import logger from "@/src/runtime/logger"

/** Alarm cleanup is best effort after the owning state has been acknowledged. */
export async function clearProviderPolicyAlarm(
  name: string,
  warning: string
): Promise<void> {
  if (!chrome.alarms?.clear) return
  try {
    await chrome.alarms.clear(name)
  } catch (error) {
    logger.warn(warning, error)
  }
}
