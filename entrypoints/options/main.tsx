/** Tako options page. */
import { createRoot } from "react-dom/client"
import "@/globals.css"
import "./options.css"

import { ErrorBoundary } from "@/src/ui/shared/components/ErrorBoundary"
import { installDiagnosticCapture } from "@/src/runtime/diagnostic-capture"
import { trackLocalDiagnosticPreference } from "@/src/runtime/diagnostic-preference"
import { OptionsPage } from "./main-options-page"

const container = document.getElementById("root")
if (container) {
  installDiagnosticCapture("options")
  trackLocalDiagnosticPreference()
  createRoot(container).render(
    <ErrorBoundary>
      <OptionsPage />
    </ErrorBoundary>
  )
}
