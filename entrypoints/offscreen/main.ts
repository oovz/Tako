import { OffscreenWorker } from "./main-worker"
import { registerOffscreenRuntime } from "./runtime-bridge"
import { createOffscreenStatusController } from "./status-ui"
import logger from "@/src/runtime/logger"

const worker = new OffscreenWorker()
const statusController = createOffscreenStatusController(worker)

registerOffscreenRuntime(worker, {
  onInitialized: () => {
    statusController.onInitialized()
  },
  onInitializationError: (errorMessage: string) => {
    statusController.onInitializationError(errorMessage)
  },
})

document.addEventListener("DOMContentLoaded", () => {
  try {
    statusController.initializeDom()
  } catch (error) {
    statusController.reportBootstrapError(error)
  }
})

logger.debug("✅ Offscreen document script loaded")
