import logger from "@/src/runtime/logger"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"

export async function refreshFolderActionItem(): Promise<void> {
  try {
    const result = await sendRuntimeMessage({
      target: "background",
      type: "REFRESH_FOLDER_ACTION_ITEM",
    })
    if (!result.success) throw new Error(result.error)
  } catch (error) {
    logger.debug("Failed to refresh folder indicator", error)
  }
}
