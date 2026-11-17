import logger, { startDiagnosticRecording } from "./logger"
import type { DiagnosticContext } from "./diagnostic-store"

const installed = new WeakMap<EventTarget, () => void>()

/** Called by the entrypoint once per document or service worker lifetime. */
export function installDiagnosticCapture(
  context: DiagnosticContext,
  scope: EventTarget = globalThis
): () => void {
  const existing = installed.get(scope)
  if (existing) return existing

  startDiagnosticRecording(context)
  const onError = (event: Event) => {
    if (!("message" in event)) return
    const error = event as ErrorEvent
    logger.error("Uncaught error", {
      message: error.message,
      error: error.error as unknown,
      source: error.filename,
      line: error.lineno,
      column: error.colno,
    })
  }
  const onRejection = (event: Event) => {
    logger.error(
      "Unhandled promise rejection",
      (event as PromiseRejectionEvent).reason as unknown
    )
  }
  scope.addEventListener("error", onError)
  scope.addEventListener("unhandledrejection", onRejection)
  const stop = () => {
    if (installed.get(scope) !== stop) return
    scope.removeEventListener("error", onError)
    scope.removeEventListener("unhandledrejection", onRejection)
    installed.delete(scope)
  }
  installed.set(scope, stop)
  return stop
}
